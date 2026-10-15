import type {AddressMapFallback} from './address-map-fallback';
import {gpsDistanceMeters, validGpsCoordinates, GPS_SITE_RADIUS_METERS} from './gps-presence-policy';

export type VisitPin = {location:{latitude:number;longitude:number}; approximate:boolean; sourceAddress?:string; source?:string; matchedAddress?:string; detail?:string; stale?:boolean};
export type VisitPinJob = {appointmentId:string; status?:string; location?:VisitPin['location']|null; mapFallback?:AddressMapFallback|null};
/** Navigation estimates cannot establish GPS arrivals or departures. */
export function appointmentVisitPin(job: Pick<VisitPinJob,'location'|'mapFallback'>): VisitPin|null {
  if(job.location && validGpsCoordinates(job.location))return {location:job.location,approximate:false};
  return null;
}
/** Historical approximate records remain visible, but cannot infer new presence
 * or departure, even after the current address obtains a verified replacement. */
export function visitEvidenceLocation(job: Pick<VisitPinJob,'location'|'mapFallback'>, recorded?: VisitPin|null) {
  if(recorded?.approximate)return null;
  return recorded && validGpsCoordinates(recorded.location) ? recorded.location : appointmentVisitPin(job)?.location;
}
/** Overlapping 200m circles involving an approximate pin cannot identify a stop.
 * Include completed appointments: booking status cannot disambiguate physical GPS.
 * Keep existing verified/verified handling unchanged. */
export function ambiguousVisitPin(job:VisitPinJob, appointments:VisitPinJob[]) {
  const pin=appointmentVisitPin(job);
  return !!pin && appointments.some(other=>{
    if(other.appointmentId===job.appointmentId || /cancel/i.test(other.status || ''))return false;
    const candidate=appointmentVisitPin(other);
    return candidate && (pin.approximate || candidate.approximate)
      && gpsDistanceMeters(pin.location,candidate.location)<=2*GPS_SITE_RADIUS_METERS;
  });
}
