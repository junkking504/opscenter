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
/** Ambiguity belongs to the observed point, not the overlap of two circles.
 * Completed jobs still compete; booking status and assignment cannot locate GPS.
 * Without a usable observation, retain the conservative pin-only check.
 */
export function ambiguousVisitPin(job:VisitPinJob, appointments:VisitPinJob[], position?: {latitude?:number|null;longitude?:number|null}) {
  const pin=appointmentVisitPin(job);
  if (!pin) return false;
  const observed=position && validGpsCoordinates(position) ? position : undefined;
  return appointments.some(other=>{
    if(other.appointmentId===job.appointmentId || /cancel/i.test(other.status || ''))return false;
    const candidate=appointmentVisitPin(other);
    return candidate && gpsDistanceMeters(observed || pin.location,candidate.location) <= (observed ? GPS_SITE_RADIUS_METERS : 2*GPS_SITE_RADIUS_METERS);
  });
}
