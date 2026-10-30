import {gpsDistanceMeters, validGpsCoordinates} from './gps-presence-policy';
import {PARKED_GPS_MAX_AGE_MS, parkedTruckObservation} from './truck-gps-status';
import type {ParkedPoint} from './parked-onsite-presence';

type Observation = Omit<ParkedPoint, 'timestamp'> & {lastGpsUpdate: string | null; routePoints?: ParkedPoint[]};

/** A location fact, never a dwell interval. Poll heartbeats omit ignition;
 * retain the prior explicit parked state only through corroborating stationary
 * positions. Keep the latest real observation time, never advance it to now. */
export function parkedJobLocation(observation: Observation, now = Date.now(), since = -Infinity) {
  const stamp = Date.parse(observation.lastGpsUpdate || '');
  if (!Number.isFinite(stamp) || stamp <= since || stamp > now || now-stamp > PARKED_GPS_MAX_AGE_MS
    || !validGpsCoordinates(observation) || observation.speed !== 0) return;
  const grouped = new Map<number, ParkedPoint[]>();
  for (const point of [...(observation.routePoints || []), {...observation,timestamp:observation.lastGpsUpdate!}]) {
    const time = Date.parse(point.timestamp);
    if (!Number.isFinite(time) || time <= since || time > now) continue;
    grouped.set(time,[...(grouped.get(time) || []),point]);
  }
  // A later contradictory fix supersedes an older authoritative snapshot.
  if ([...grouped.keys()].some(time=>time>stamp)) return;
  let later = stamp;
  for (const [time, samples] of [...grouped].sort((a,b)=>b[0]-a[0])) {
    const primary = samples.filter(p=>p.deliverySource==='v3_position_push');
    const selected = primary.length ? primary : samples;
    if (later-time>PARKED_GPS_MAX_AGE_MS || selected.some(p=>!validGpsCoordinates(p) || (p.speed!==0 && !(time===stamp && p.speed==null))
      || gpsDistanceMeters(observation,p)>30 || p.ignition?.trim().toUpperCase()==='ON')) return;
    if (selected.some(parkedTruckObservation)) return {observedAt:observation.lastGpsUpdate!,parked:true as const};
    later=time;
  }
}
