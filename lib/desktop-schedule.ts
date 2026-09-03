import fs from 'node:fs';
import path from 'node:path';
import { readJobRows, junkwareScheduleUpdatedAt, type JobRow } from '@/lib/desktop-schedule-source';
import { buildFleetMapPayload } from '@/lib/fleet-map';
import { planningLocation } from '@/lib/planning-geocodes';
import { googleTrafficMatrix, type GoogleRouteMatrixElement, type Coordinates } from '@/lib/job-route-proximity';

export type DesktopAppointment = JobRow & { recordId: string; location: Coordinates | null };
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
  const appointments: DesktopAppointment[] = readJobRows(date).map((job, index) => ({
    ...job,
    // A JK reference can span multiple appointments. Never use it as the
    // mutation identity or combine separate estimate/job appointments by JK.
    recordId: job.appointmentId ? `${date}:appointment:${job.appointmentId}` : `${date}:unverified:${index}`,
    location: planningLocation(job.address, pins),
  }));
  return {
    date,
    observedAt: junkwareScheduleUpdatedAt(date),
    appointments,
    fleet: buildFleetMapPayload(date),
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
  // 25x25 stays inside the existing provider's 625-element limit. Process
  // chunks serially rather than flooding a routing provider with requests.
  for (let start = 0; start < located.length; start += 25) {
    const chunk = located.slice(start, start + 25);
    const matrix = await provider(chunk.map(leg => byId.get(leg.fromAppointmentId)!.location!), chunk.map(leg => byId.get(leg.toAppointmentId)!.location!));
    for (const element of matrix || []) {
      const index = element.originIndex ?? 0;
      if (index !== (element.destinationIndex ?? 0)) continue;
      const leg = chunk[index];
      const seconds = typeof element.duration === 'string' && /^\d+(?:\.\d+)?s$/.test(element.duration) ? Number(element.duration.slice(0, -1)) : NaN;
      const meters = Number(element.distanceMeters);
      if (!leg || element.status?.code || element.condition !== 'ROUTE_EXISTS' || !Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(meters) || meters < 0) continue;
      leg.travelMinutes = Math.ceil(seconds / 60);
      leg.miles = Math.round(meters / 1609.344 * 10) / 10;
      leg.bufferMinutes = leg.gapMinutes - leg.travelMinutes;
      leg.source = 'google_live_traffic';
    }
  }
  return legs;
}
