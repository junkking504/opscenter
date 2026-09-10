import type { FleetMapPoint } from './fleet-map';
import type { Coordinates } from './job-route-proximity';
import { truckLabel } from '../desktop-ui/lib/schedule-contract';
import { parkedTruckObservation, PARKED_GPS_MAX_AGE_MS } from './truck-gps-status';

type PresenceJob = { truck?: string; appointmentId: string; location?: Coordinates | null; status?: string; appointmentStartMinutes?: number | null; appointmentEndMinutes?: number | null; onsiteTime?: {departure?: string | null} };
export type PresenceTruck = { truck: string; lastGpsUpdate: string | null; latitude?: number | null; longitude?: number | null; speed?: number | null; ignition?: string | null; routePoints?: Pick<FleetMapPoint, 'timestamp' | 'latitude' | 'longitude' | 'continuousUntil'>[] };
const distance = (a: Coordinates, b: Coordinates) => {
  const rad = Math.PI / 180, dLat = (a.latitude - b.latitude) * rad, dLon = (a.longitude - b.longitude) * rad;
  return 12_742_000 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2));
};

// Current Schedule data can lead the slower visit ledger after a dispatch move.
// Show physical presence on the first GPS report at one eligible appointment.
// Visit-duration accounting remains in the separately confirmed visit ledger.
export function currentGpsPresence(job: PresenceJob, trucks: PresenceTruck[], appointments: PresenceJob[], now = Date.now()) {
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const minute = Number(clock.find(p => p.type === 'hour')?.value) * 60 + Number(clock.find(p => p.type === 'minute')?.value);
  const eligible = (row: PresenceJob, truck?: PresenceTruck) => row.location && !/cancel|completed|closed/i.test(row.status || '') &&
    ((truck && truckLabel(row.truck || '') !== 'Unassigned' && truckLabel(row.truck || '') === truckLabel(truck.truck)) || ((row.appointmentStartMinutes == null || minute >= row.appointmentStartMinutes - 90) &&
    (row.appointmentEndMinutes == null || minute <= row.appointmentEndMinutes + 360)));
  if (!job.location || /cancel|completed|closed/i.test(job.status || '')) return undefined;
  const candidates = trucks.flatMap(truck => {
    const stamp = Date.parse(truck.lastGpsUpdate || '');
    if (!Number.isFinite(stamp) || stamp > now + 60_000 || now - stamp > 12 * 3600_000 || truck.latitude == null || truck.longitude == null || !Number.isFinite(truck.latitude) || !Number.isFinite(truck.longitude)) return [];
    if (Date.parse(job.onsiteTime?.departure || '') >= stamp) return [];
    const position = { latitude: truck.latitude, longitude: truck.longitude };
    if (!eligible(job, truck) || distance(position, job.location!) > 125) return [];
    const nearby = appointments.filter(row => eligible(row, truck) && distance(position, row.location!) <= 125);
    if (nearby.length !== 1 || nearby[0].appointmentId !== job.appointmentId) return [];
    // The current position is authoritative even when route history and the
    // visit ledger have not caught up. Do not wait for a second report or dwell.
    // Engine-off trackers report hourly. Use the same parked heartbeat window
    // as the truck marker; elapsed time alone must not imply a departure.
    const maxAge = parkedTruckObservation(truck) ? PARKED_GPS_MAX_AGE_MS : 10 * 60_000;
    return [{ truck: truckLabel(truck.truck), arrival: new Date(stamp).toISOString(), observedAt: truck.lastGpsUpdate!, current: now - stamp <= maxAge }];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}
