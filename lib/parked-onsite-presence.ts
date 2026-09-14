import { gpsDistanceMeters, gpsDwellAtPosition, GPS_PRESENCE_MAX_AGE_MS, GPS_MAX_POINT_GAP_MS, GPS_SITE_RADIUS_METERS, type DwellPoint } from './gps-presence-policy';
import { parkedTruckObservation, PARKED_GPS_MAX_AGE_MS } from './truck-gps-status';

export type ParkedPoint = DwellPoint & { speed?: number | null; ignition?: string | null; deliverySource?: string };
type Observation = Omit<ParkedPoint, 'timestamp'> & { lastGpsUpdate: string | null };

function shutdownArrival(location: { latitude?: number | null; longitude?: number | null }, point: ParkedPoint, previous?: ParkedPoint) {
  const stamp = Date.parse(point.timestamp);
  if (parkedTruckObservation(point) && typeof previous?.speed === 'number' && previous.speed >= 0 && previous.speed <= 2 && previous.ignition === 'ON'
    && stamp > Date.parse(previous.timestamp) && stamp - Date.parse(previous.timestamp) <= GPS_MAX_POINT_GAP_MS
    && gpsDistanceMeters(location, previous) <= GPS_SITE_RADIUS_METERS
    && gpsDistanceMeters(previous, point) <= 30) return { arrival: Date.parse(previous.timestamp), stamp };
}

// Presence and motion freshness are separate: an established visit can remain
// on site during the tracker's normal engine-off heartbeat interval.
export const onsiteGpsMaxAge = (observation: { speed?: number | null; ignition?: string | null }) =>
  parkedTruckObservation(observation) ? PARKED_GPS_MAX_AGE_MS : GPS_PRESENCE_MAX_AGE_MS;

export function onsiteGpsDwell(location: { latitude?: number | null; longitude?: number | null }, observation: Observation, points: ParkedPoint[], since = -Infinity) {
  const direct = gpsDwellAtPosition(location, observation, points, since);
  if (direct || observation.speed !== 0) return direct;
  const stamp = Date.parse(observation.lastGpsUpdate || '');
  if (!Number.isFinite(stamp) || gpsDistanceMeters(location, observation) > GPS_SITE_RADIUS_METERS) return;
  // Prefer the authoritative push when reconciliation repeats its timestamp.
  const primaryTimes = new Set(points.filter(p => p.deliverySource === 'v3_position_push').map(p => Date.parse(p.timestamp)));
  const prior = points.filter(p => Date.parse(p.timestamp) >= since && Date.parse(p.timestamp) < stamp
    && (!primaryTimes.has(Date.parse(p.timestamp)) || p.deliverySource === 'v3_position_push'))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  // A stationary ON -> OFF transition at the premise establishes a stop before
  // the normal two-minute dwell. Waiting for another fix after engine shutdown
  // can otherwise hide arrival until the hourly parked heartbeat.
  let later: ParkedPoint = { ...observation, timestamp: observation.lastGpsUpdate! };
  const shutdown = shutdownArrival(location, later, prior[0]);
  if (shutdown) return shutdown;
  for (const [index, point] of prior.entries()) {
    const elapsed = Date.parse(later.timestamp) - Date.parse(point.timestamp);
    if (point.speed !== 0 || later.speed !== 0
      || (elapsed > GPS_MAX_POINT_GAP_MS && !parkedTruckObservation(point))
      || elapsed > PARKED_GPS_MAX_AGE_MS || gpsDistanceMeters(point, later) > 30
      || gpsDistanceMeters(location, point) > GPS_SITE_RADIUS_METERS) return;
    // Hourly fixes may retain a visit, but cannot establish its initial dwell.
    const established = gpsDwellAtPosition(location, { ...point, lastGpsUpdate: point.timestamp }, points, since)
      || shutdownArrival(location, point, prior[index + 1]);
    if (established) return { arrival: established.arrival, stamp };
    later = point;
  }
}
