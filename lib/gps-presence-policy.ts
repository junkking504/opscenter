// Shared by legacy map beacons and the desktop Schedule read model. Parked
// heartbeat tolerance describes last-known location, never current presence.
export const GPS_PRESENCE_MAX_AGE_MS = 3 * 60_000;
export const GPS_SITE_RADIUS_METERS = 200;
export const GPS_MINIMUM_DWELL_MS = 2 * 60_000;
export const GPS_MAX_POINT_GAP_MS = 5 * 60_000;
type Position = { latitude?: number | null; longitude?: number | null };
export type DwellPoint = Position & { timestamp: string; continuousUntil?: string | null };
export function validGpsCoordinates(point: Position): point is { latitude: number; longitude: number } {
  return typeof point.latitude === 'number' && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && typeof point.longitude === 'number' && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}
export function gpsDistanceMeters(a: Position, b: Position): number {
  if (!validGpsCoordinates(a) || !validGpsCoordinates(b)) return Infinity;
  const rad = Math.PI / 180, lat = (a.latitude - b.latitude) * rad, lon = (a.longitude - b.longitude) * rad;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(lon / 2) ** 2)));
}
export function gpsDwellAtPosition(location: Position, observation: Position & { lastGpsUpdate: string | null }, points: DwellPoint[], since = -Infinity) {
  const stamp = Date.parse(observation.lastGpsUpdate || '');
  if (!Number.isFinite(stamp) || stamp < since || gpsDistanceMeters(location, observation) > GPS_SITE_RADIUS_METERS) return;
  // The authoritative latest fix wins over older route snapshots. Never extend
  // dwell to wall-clock time or bridge an unobserved gap without source evidence.
  const prior = points.map(point => ({ ...point, time: Date.parse(point.timestamp) }))
    .filter(point => Number.isFinite(point.time) && point.time >= since && point.time < stamp)
    .sort((a, b) => b.time - a.time);
  let arrival = stamp;
  for (const point of prior) {
    if (gpsDistanceMeters(location, point) > GPS_SITE_RADIUS_METERS) break;
    const until = Date.parse(point.continuousUntil || '');
    if (arrival - point.time > GPS_MAX_POINT_GAP_MS && !(Number.isFinite(until) && until >= arrival)) break;
    arrival = point.time;
  }
  return stamp - arrival >= GPS_MINIMUM_DWELL_MS ? { arrival, stamp } : undefined;
}
