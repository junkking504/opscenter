import type { FleetMapPoint } from './fleet-map';
import type { Coordinates } from './job-route-proximity';
import { truckLabel } from '../desktop-ui/lib/schedule-contract';

type PresenceJob = { truck?: string; appointmentId: string; location?: Coordinates | null; status?: string; appointmentStartMinutes?: number | null; appointmentEndMinutes?: number | null };
export type PresenceTruck = { truck: string; lastGpsUpdate: string | null; latitude?: number | null; longitude?: number | null; routePoints?: Pick<FleetMapPoint, 'timestamp' | 'latitude' | 'longitude' | 'continuousUntil'>[] };
const distance = (a: Coordinates, b: Coordinates) => {
  const rad = Math.PI / 180, dLat = (a.latitude - b.latitude) * rad, dLon = (a.longitude - b.longitude) * rad;
  return 12_742_000 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2));
};

// Current Schedule data can lead the slower visit ledger after a dispatch move.
// Require continuous physical dwell at one eligible appointment; never infer
// presence from an assignment, one GPS point, or a road ETA.
export function currentGpsPresence(job: PresenceJob, trucks: PresenceTruck[], appointments: PresenceJob[], now = Date.now()) {
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const minute = Number(clock.find(p => p.type === 'hour')?.value) * 60 + Number(clock.find(p => p.type === 'minute')?.value);
  const eligible = (row: PresenceJob, truck?: PresenceTruck) => row.location && !/cancel|completed|closed/i.test(row.status || '') &&
    ((truck && truckLabel(row.truck || '') !== 'Unassigned' && truckLabel(row.truck || '') === truckLabel(truck.truck)) || ((row.appointmentStartMinutes == null || minute >= row.appointmentStartMinutes - 90) &&
    (row.appointmentEndMinutes == null || minute <= row.appointmentEndMinutes + 360)));
  if (!job.location || /cancel|completed|closed/i.test(job.status || '')) return undefined;
  const candidates = trucks.flatMap(truck => {
    const stamp = Date.parse(truck.lastGpsUpdate || '');
    if (!Number.isFinite(stamp) || stamp > now + 60_000 || now - stamp > 10 * 60_000 || truck.latitude == null || truck.longitude == null) return [];
    const position = { latitude: truck.latitude, longitude: truck.longitude };
    if (!eligible(job, truck) || distance(position, job.location!) > 125) return [];
    const nearby = appointments.filter(row => eligible(row, truck) && distance(position, row.location!) <= 125);
    if (nearby.length !== 1 || nearby[0].appointmentId !== job.appointmentId) return [];
    const points = (truck.routePoints || []).map(point => ({ ...point, time: Date.parse(point.timestamp) }))
      .filter(point => Number.isFinite(point.time) && point.time <= now + 60_000 && now - point.time < 12 * 3600_000)
      .sort((a, b) => a.time - b.time);
    const latest = points.at(-1);
    if (!latest || now - latest.time > 10 * 60_000 || distance(latest, job.location!) > 125) return [];
    let arrival = latest.time, count = 1;
    for (let i = points.length - 2; i >= 0; i--) {
      const point = points[i];
      if (distance(point, job.location!) > 125 || (arrival - point.time > 5 * 60_000 && Date.parse(point.continuousUntil || '') < arrival)) break;
      // Missing continuity must not bridge a long reporting outage.
      if (arrival - point.time > 5 * 60_000 && !Number.isFinite(Date.parse(point.continuousUntil || ''))) break;
      if (point.time < arrival) count++;
      arrival = point.time;
    }
    return count >= 2 && latest.time - arrival >= 2 * 60_000
      ? [{ truck: truckLabel(truck.truck), arrival: new Date(arrival).toISOString(), observedAt: latest.timestamp }] : [];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}
