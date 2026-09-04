import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJobRows, junkwareScheduleUpdatedAt, type JobRow } from '@/lib/desktop-schedule-source';
import { buildFleetMapPayload } from '@/lib/fleet-map';
import { planningLocation } from '@/lib/planning-geocodes';
import { googleTrafficMatrix, type GoogleRouteMatrixElement, type Coordinates } from '@/lib/job-route-proximity';
import { LINXUP_V3_AUTHORITY_MAX_AGE_SECONDS } from '@/lib/linxup-authority';
import type { ClosestTruck, ScheduleTruck } from '../desktop-ui/lib/schedule-contract';
import { readJobRouteAssignmentOverrides } from '@/lib/job-route-assignments';
import { jobCallAheadLookupKey, readJobCallAheadStatuses } from '@/lib/job-call-ahead';

export type DesktopAppointment = JobRow & { recordId: string; version: string; callAhead: 'called' | 'not_called'; location: Coordinates | null };
export type DesktopRouteLeg = {
  truck: string;
  fromAppointmentId: string;
  toAppointmentId: string;
  fromJk: string;
  toJk: string;
  gapMinutes: number;
  travelMinutes: number | null;
  miles: number | null;
  bufferMinutes: number | null;
  source: 'google_live_traffic' | 'unavailable';
};

function geocodes(): Record<string, Record<string, unknown>> {
  const directory = process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw', 'workspace', 'opsbot', 'data');
  try {
    const value = JSON.parse(fs.readFileSync(path.join(directory, 'cache', 'appointment_geocodes.json'), 'utf8'));
    return value.addresses && typeof value.addresses === 'object' ? value.addresses : {};
  } catch { return {}; }
}

export function readDesktopSchedule(date: string) {
  const pins = geocodes();
  const overrides = readJobRouteAssignmentOverrides(date);
  const calls = readJobCallAheadStatuses();
  const appointments: DesktopAppointment[] = readJobRows(date).map((source, index) => {
    const override = overrides.get(`appt:${source.appointmentId}`);
    const job = override ? {
      ...source, truck: override.truck || 'Unassigned', assignedTruck: override.truck || 'Unassigned',
      appointmentTime: override.appointmentTime || source.appointmentTime,
      appointmentStartMinutes: override.appointmentStartMinutes ?? source.appointmentStartMinutes,
      appointmentEndMinutes: override.appointmentEndMinutes ?? source.appointmentEndMinutes,
      hasScheduledTime: override.appointmentStartMinutes !== undefined || source.hasScheduledTime,
      junkwareSyncStatus: override.junkwareSyncStatus, junkwareSyncError: override.junkwareSyncError,
    } : source;
    const callAhead = calls.get(jobCallAheadLookupKey(date, `appt:${job.appointmentId}`)) || 'not_called';
    return {
    ...job, callAhead,
    version: createHash('sha256').update(JSON.stringify([job.appointmentId, job.truck, job.appointmentStartMinutes, job.appointmentEndMinutes, job.status, job.appointmentNotes, job.cancellationReason, callAhead, job.closeout, job.driver, job.navigator, job.additionalCrew])).digest('hex'),
    // A JK reference can span multiple appointments. Never use it as the
    // mutation identity or combine separate estimate/job appointments by JK.
    recordId: job.appointmentId ? `${date}:appointment:${job.appointmentId}` : `${date}:unverified:${index}`,
    location: planningLocation(job.address, pins),
  }; });
  return {
    date,
    observedAt: junkwareScheduleUpdatedAt(date),
    appointments,
    fleet: buildFleetMapPayload(date) || { date, isToday: false, trucks: [], lastUpdatedAt: null },
  };
}

type MatrixProvider = (origins: Coordinates[], destinations: Coordinates[]) => Promise<GoogleRouteMatrixElement[] | null>;

export function scheduleRoutePairs(appointments: DesktopAppointment[]): DesktopRouteLeg[] {
  const trucks = new Map<string, DesktopAppointment[]>();
  for (const appointment of appointments) {
    if (/cancel/i.test(appointment.status) || !appointment.truck || /unassigned|virtual|^—$/i.test(appointment.truck) || !appointment.hasScheduledTime) continue;
    const rows = trucks.get(appointment.truck) || [];
    rows.push(appointment);
    trucks.set(appointment.truck, rows);
  }
  return [...trucks.entries()].flatMap(([truck, jobs]) => {
    jobs.sort((a, b) => (a.appointmentStartMinutes ?? Infinity) - (b.appointmentStartMinutes ?? Infinity));
    return jobs.slice(1).map((to, index) => {
      const from = jobs[index];
      return {
        truck, fromAppointmentId: from.recordId, toAppointmentId: to.recordId,
        fromJk: from.jkNumber, toJk: to.jkNumber,
        gapMinutes: (to.appointmentStartMinutes || 0) - (from.appointmentEndMinutes || 0),
        travelMinutes: null, miles: null, bufferMinutes: null, source: 'unavailable' as const,
      };
    });
  });
}

export async function calculateDesktopRouteLegs(appointments: DesktopAppointment[], provider: MatrixProvider = googleTrafficMatrix): Promise<DesktopRouteLeg[]> {
  const legs = scheduleRoutePairs(appointments);
  const byId = new Map(appointments.map(job => [job.recordId, job]));
  const located = legs.filter(leg => byId.get(leg.fromAppointmentId)?.location && byId.get(leg.toAppointmentId)?.location);
  // Only adjacent appointment pairs are needed, not an N x N matrix of
  // unrelated appointments. Bill one element per leg, with bounded concurrency.
  for (let start = 0; start < located.length; start += 4) {
    await Promise.all(located.slice(start, start + 4).map(async leg => {
      const matrix = await provider([byId.get(leg.fromAppointmentId)!.location!], [byId.get(leg.toAppointmentId)!.location!]);
      const element = matrix?.find(row => (row.originIndex ?? 0) === 0 && (row.destinationIndex ?? 0) === 0);
      if (!element) return;
      const seconds = typeof element.duration === 'string' && /^\d+(?:\.\d+)?s$/.test(element.duration) ? Number(element.duration.slice(0, -1)) : NaN;
      const meters = element.distanceMeters;
      if (element.status?.code || element.condition !== 'ROUTE_EXISTS' || !Number.isFinite(seconds) || seconds < 0 || typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) return;
      leg.travelMinutes = Math.ceil(seconds / 60);
      leg.miles = Math.round(meters / 1609.344 * 10) / 10;
      leg.bufferMinutes = leg.gapMinutes - leg.travelMinutes;
      leg.source = 'google_live_traffic';
    }));
  }
  return legs;
}

export async function calculateClosestTrucks(appointment: DesktopAppointment, trucks: ScheduleTruck[], isToday: boolean, provider: MatrixProvider = googleTrafficMatrix, now = Date.now()): Promise<ClosestTruck[]> {
  const rows: ClosestTruck[] = trucks.map(truck => {
    const updated = Date.parse(truck.lastGpsUpdate || '');
    const located = truck.latitude !== null && truck.longitude !== null && Number.isFinite(truck.latitude) && Number.isFinite(truck.longitude);
    const fresh = Number.isFinite(updated) && updated <= now && now - updated <= LINXUP_V3_AUTHORITY_MAX_AGE_SECONDS * 1000;
    return { truck: truck.truck, gpsUpdatedAt: truck.lastGpsUpdate, minutes: null, miles: null, status: !isToday ? 'not_live_day' : !appointment.location ? 'address_unverified' : !located ? 'gps_unavailable' : !fresh ? 'stale_gps' : 'routing_unavailable' };
  });
  const eligible = rows.filter(row => row.status === 'routing_unavailable');
  for (let offset = 0; offset < eligible.length; offset += 25) {
    const chunk = eligible.slice(offset, offset + 25);
    const matrix = await provider(chunk.map(row => {
      const truck = trucks.find(item => item.truck === row.truck)!;
      return { latitude: truck.latitude!, longitude: truck.longitude! };
    }), [appointment.location!]);
    for (const element of matrix || []) {
      if ((element.destinationIndex ?? 0) !== 0) continue;
      const row = chunk[element.originIndex ?? 0];
      const seconds = typeof element.duration === 'string' && /^\d+(?:\.\d+)?s$/.test(element.duration) ? Number(element.duration.slice(0, -1)) : NaN;
      const meters = element.distanceMeters;
      if (!row || element.status?.code || element.condition !== 'ROUTE_EXISTS' || !Number.isFinite(seconds) || seconds < 0 || typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) continue;
      row.minutes = Math.ceil(seconds / 60);
      row.miles = Math.round(meters / 1609.344 * 10) / 10;
      row.status = 'available';
    }
  }
  return rows.sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity));
}

// Deduplicate concurrent browser requests and reuse estimates briefly. Keys
// include source identity, geometry, assignment and GPS freshness, not just JK.
type TimedRouting<T> = { data: T; calculatedAt: string };
const routingCache = new Map<string, { expires: number; result: Promise<TimedRouting<unknown>> }>();
async function cachedRouting<T>(keyParts: unknown, read: () => Promise<T>): Promise<TimedRouting<T>> {
  const key = createHash('sha256').update(JSON.stringify(keyParts)).digest('hex');
  const existing = routingCache.get(key);
  if (existing && existing.expires > Date.now()) return existing.result as Promise<TimedRouting<T>>;
  for (const [entry, value] of routingCache) if (value.expires <= Date.now()) routingCache.delete(entry);
  if (routingCache.size >= 64) routingCache.delete(routingCache.keys().next().value!);
  const result = read().then(data => ({ data, calculatedAt: new Date().toISOString() })).catch(error => { routingCache.delete(key); throw error; });
  routingCache.set(key, { expires: Date.now() + 120_000, result });
  return result;
}

export async function readDesktopScheduleRouting(date: string, recordId: string | null) {
  const snapshot = readDesktopSchedule(date);
  const target = recordId ? snapshot.appointments.find(job => job.recordId === recordId) : undefined;
  if (recordId && !target) return null;
  const legs = await cachedRouting(['legs', date, snapshot.appointments.map(job => [job.recordId, job.truck, job.status, job.appointmentStartMinutes, job.appointmentEndMinutes, job.location])], () => calculateDesktopRouteLegs(snapshot.appointments));
  // Refresh GPS eligibility before every comparison; cached travel must never
  // promote a now-stale truck to a live nearest-truck recommendation.
  const now = Date.now();
  const closest = target ? await cachedRouting(['closest', date, target.recordId, target.location, snapshot.fleet.isToday, snapshot.fleet.trucks.map(truck => [truck.truck, truck.latitude, truck.longitude, truck.lastGpsUpdate, now - Date.parse(truck.lastGpsUpdate || '') <= LINXUP_V3_AUTHORITY_MAX_AGE_SECONDS * 1000])], () => calculateClosestTrucks(target, snapshot.fleet.trucks, snapshot.fleet.isToday)) : null;
  return { date, calculatedAt: legs.calculatedAt, closestCalculatedAt: closest?.calculatedAt || null, appointmentId: target?.recordId || null, legs: legs.data, closest: closest?.data || [] };
}
