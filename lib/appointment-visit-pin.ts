import type {AddressMapFallback} from './address-map-fallback';
import {gpsDistanceMeters, validGpsCoordinates, GPS_SITE_RADIUS_METERS} from './gps-presence-policy';

export type VisitPin = {location:{latitude:number;longitude:number}; approximate:boolean; sourceAddress?:string; source?:string; matchedAddress?:string; detail?:string; stale?:boolean};
export type VisitPinJob = {appointmentId:string; status?:string; location?:VisitPin['location']|null; mapFallback?:AddressMapFallback|null};
/** A visit point is separate from the verified location and address status. */
export function appointmentVisitPin(job: Pick<VisitPinJob,'location'|'mapFallback'>): VisitPin|null {
  if(job.location && validGpsCoordinates(job.location))return {location:job.location,approximate:false};
  const fallback=job.mapFallback;
  return fallback && fallback.visitEligible!==false && validGpsCoordinates(fallback.location) ? {...fallback,approximate:true} : null;
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
