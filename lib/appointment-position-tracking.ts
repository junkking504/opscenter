import {gpsDistanceMeters,validGpsCoordinates,GPS_SITE_RADIUS_METERS,GPS_MAX_POINT_GAP_MS,type DwellPoint} from './gps-presence-policy';
import type {PresenceTruck} from './schedule-gps-presence';
import type {TrackedVisit} from './visit-tracking-agent';

type JobLocation = {appointmentId: string; jkNumber?: string; location?: {latitude:number;longitude:number} | null};
const truckKey = (value: string) => value.match(/\d+/)?.[0]?.replace(/^0+/, '') || '';

/** Reconcile only an already-confirmed appointment visit with later coordinates.
 * Two distinct fixes at least a minute apart and well outside the site radius
 * establish departure. A single noisy fix, unknown address, sparse history or
 * current assignment cannot create a visit or a precise exit time.
 */
export function reconcileAppointmentPositions(visits: TrackedVisit[], jobs: JobLocation[], trucks: PresenceTruck[], now=Date.now()): TrackedVisit[] {
  return visits.map(visit=>{
    if (visit.kind !== 'appointment' || visit.departedAt || visit.conflict || visit.arrivalSource !== 'confirmed_appointment') return visit;
    const nextVisit = visits.filter(next=>next.kind === 'appointment' && next.appointmentId === visit.appointmentId && next.truck === visit.truck && Date.parse(next.enteredAt || '') > Date.parse(visit.enteredAt || '')).sort((a,b)=>(a.enteredAt || '').localeCompare(b.enteredAt || ''))[0];
    const segmentEnd = nextVisit ? Date.parse(nextVisit.enteredAt!) : Infinity;
    const unresolved = nextVisit ? {...visit,supersededAt:nextVisit.enteredAt!} : visit;
    const matching = jobs.filter(job=>job.appointmentId === visit.appointmentId && (!job.jkNumber || job.jkNumber === visit.jobNumber));
    const location = matching.length === 1 ? matching[0].location : null;
    if (!location || !validGpsCoordinates(location)) return unresolved;
    const matchingTrucks = trucks.filter(truck=>truckKey(truck.truck) === truckKey(visit.truck));
    if (matchingTrucks.length !== 1) return unresolved;
    const truck = matchingTrucks[0];
    const lastSeen = Date.parse(visit.lastSeenAt);
    const points: DwellPoint[] = [...(truck.routePoints || []), {timestamp:truck.lastGpsUpdate || '',latitude:truck.latitude,longitude:truck.longitude}];
    const grouped = new Map<number,DwellPoint[]>();
    for (const point of points) {
      const stamp = Date.parse(point.timestamp);
      if (!Number.isFinite(stamp) || stamp <= lastSeen || stamp > now || stamp >= segmentEnd || !validGpsCoordinates(point)) continue;
      grouped.set(stamp,[...(grouped.get(stamp) || []),point]);
    }
    let after=lastSeen, outside: number[]=[];
    for (const [stamp, samples] of [...grouped].sort((a,b)=>a[0]-b[0])) {
      const distances=samples.map(point=>gpsDistanceMeters(location,point));
      if (distances.some(distance=>distance <= GPS_SITE_RADIUS_METERS)) {
        after=stamp;outside=[];continue;
      }
      // A buffer around the ordinary arrival radius prevents boundary jitter.
      if (distances.some(distance=>distance <= GPS_SITE_RADIUS_METERS*2)) {outside=[];continue;}
      if (outside.length && stamp-outside.at(-1)! > GPS_MAX_POINT_GAP_MS) outside=[];
      outside.push(stamp);
      if (outside.length > 1 && stamp-outside[0] >= 60_000) {
        return {...visit,departedAt:new Date(outside[0]).toISOString(),departureSource:'later_position',
          departureBounds:{after:new Date(after).toISOString(),by:new Date(outside[0]).toISOString()},
          lastSeenAt:new Date(after).toISOString(),durationSeconds:null};
      }
    }
    return unresolved;
  });
}
