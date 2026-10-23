import type {AddressMapFallback} from './address-map-fallback';
import {gpsDistanceMeters, validGpsCoordinates, GPS_SITE_RADIUS_METERS} from './gps-presence-policy';

export type VisitPin = {location:{latitude:number;longitude:number}; approximate:boolean; sourceAddress?:string; source?:string; matchedAddress?:string; detail?:string; stale?:boolean};
export type VisitPinJob = {appointmentId:string; status?:string; location?:VisitPin['location']|null; mapFallback?:AddressMapFallback|null};
/** Display confidence is provenance, not operational eligibility. */
export function appointmentVisitPin(job: Pick<VisitPinJob,'location'|'mapFallback'>): VisitPin|null {
  if(job.location && validGpsCoordinates(job.location))return {location:job.location,approximate:false};
  const fallback=job.mapFallback;
  return fallback && validGpsCoordinates(fallback.location) ? {...fallback,approximate:true} : null;
}
/** Reconcile departures against the recorded coordinate, even if the current map changes. */
export function visitEvidenceLocation(job: Pick<VisitPinJob,'location'|'mapFallback'>, recorded?: VisitPin|null) {
  return recorded && validGpsCoordinates(recorded.location) ? recorded.location : appointmentVisitPin(job)?.location;
}
/** Overlapping 200m circles cannot uniquely identify a stop, regardless of label.
 * Include completed appointments: booking status cannot disambiguate physical GPS.
 */
export function ambiguousVisitPin(job:VisitPinJob, appointments:VisitPinJob[]) {
  const pin=appointmentVisitPin(job);
  return !!pin && appointments.some(other=>{
    if(other.appointmentId===job.appointmentId || /cancel/i.test(other.status || ''))return false;
    const candidate=appointmentVisitPin(other);
    return candidate && gpsDistanceMeters(pin.location,candidate.location)<=2*GPS_SITE_RADIUS_METERS;
  });
}
