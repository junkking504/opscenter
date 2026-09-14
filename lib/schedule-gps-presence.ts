import { onsiteGpsDwell, onsiteGpsMaxAge, type ParkedPoint } from './parked-onsite-presence';
import type { Coordinates } from './job-route-proximity';
import { truckLabel } from '../desktop-ui/lib/schedule-contract';
import { parkedTruckObservation } from './truck-gps-status';
import { gpsDistanceMeters as distance, validGpsCoordinates, GPS_SITE_RADIUS_METERS } from './gps-presence-policy';

type PresenceJob = { truck?: string; appointmentId: string; location?: Coordinates | null; status?: string; appointmentStartMinutes?: number | null; appointmentEndMinutes?: number | null; onsiteTime?: {departure?: string | null} };
export type PresenceTruck = { truck: string; lastGpsUpdate: string | null; latitude?: number | null; longitude?: number | null; speed?: number | null; ignition?: string | null; routePoints?: ParkedPoint[] };
// Use the same coordinate and live freshness rules for inferred arrivals and open
// ledger visits. A fresh timestamp alone does not locate a truck at a job.
export function gpsPositionAtAppointment(location: Coordinates | null | undefined, truck: PresenceTruck, now = Date.now()) {
  const stamp = Date.parse(truck.lastGpsUpdate || '');
  if (!location || !validGpsCoordinates(location) || !validGpsCoordinates(truck) || !Number.isFinite(stamp) || stamp > now) return undefined;
  return { stamp, inside: distance(location, truck) <= GPS_SITE_RADIUS_METERS, current: now - stamp <= onsiteGpsMaxAge(truck) };
}

// Current Schedule data can lead the slower visit ledger after a dispatch move.
// Require continuous dwell at one eligible appointment before current presence.
// Visit-duration accounting remains in the separately confirmed visit ledger.
export function currentGpsPresence(job: PresenceJob, trucks: PresenceTruck[], appointments: PresenceJob[], now = Date.now()) {
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const minute = Number(clock.find(p => p.type === 'hour')?.value) * 60 + Number(clock.find(p => p.type === 'minute')?.value);
  const eligible = (row: PresenceJob, truck?: PresenceTruck) => row.location && !/cancel|completed|closed/i.test(row.status || '') &&
    ((truck && truckLabel(row.truck || '') !== 'Unassigned' && truckLabel(row.truck || '') === truckLabel(truck.truck)) || ((row.appointmentStartMinutes == null || minute >= row.appointmentStartMinutes - 90) &&
    (row.appointmentEndMinutes == null || minute <= row.appointmentEndMinutes + 360)));
  if (!job.location || /cancel|completed|closed/i.test(job.status || '')) return undefined;
  const candidates = trucks.flatMap(truck => {
    const observation = gpsPositionAtAppointment(job.location, truck, now);
    if (!observation?.inside || now - observation.stamp > 12 * 3600_000) return [];
    const { stamp } = observation;
    const departedAt = Date.parse(job.onsiteTime?.departure || '');
    const dwell = onsiteGpsDwell(job.location!, truck, truck.routePoints || [], Number.isFinite(departedAt) ? departedAt : -Infinity);
    if (!dwell) return [];
    if (Date.parse(job.onsiteTime?.departure || '') >= stamp) return [];
    const position = { latitude: truck.latitude!, longitude: truck.longitude! };
    if (!eligible(job, truck)) return [];
    const nearby = appointments.filter(row => eligible(row, truck) && distance(position, row.location!) <= GPS_SITE_RADIUS_METERS);
    if (nearby.length !== 1 || nearby[0].appointmentId !== job.appointmentId) return [];
    return [{ truck: truckLabel(truck.truck), arrival: new Date(dwell.arrival).toISOString(), observedAt: truck.lastGpsUpdate!, current: observation.current, parked: parkedTruckObservation(truck) }];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}
