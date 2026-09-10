import { compareStops } from './schedule-stop-order';
import { assignmentNeedsVerification, isClosed, truckLabel, type ScheduleAppointment, type ScheduleTruck } from '../desktop-ui/lib/schedule-contract';
import { LINXUP_V3_AUTHORITY_MAX_AGE_SECONDS } from './linxup-authority';
import { truckGpsStatus } from './truck-gps-status';

type Stop = Pick<ScheduleAppointment,'recordId'|'truck'|'status'|'appointmentType'|'appointmentStartMinutes'|'appointmentEndMinutes'|'stopOrder'|'junkwareSyncStatus'|'truckOnSite'|'onsiteTruck'|'lastSeenOnsiteTruck'|'onsiteTime'|'location'>;
export function nextTruckStop<T extends Stop>(jobs:T[], truck:string, isToday:boolean, now=Date.now()) {
  if (!isToday || !/^Truck [1-9]\d*$/.test(truckLabel(truck))) return null;
  const same=(value:string)=>truckLabel(value)===truckLabel(truck);
  const assigned=jobs.filter(job=>same(job.truck)).sort(compareStops);
  const departed=(job:T)=>Boolean(job.onsiteTime?.departure && Date.parse(job.onsiteTime.departure)<=now);
  const onsite=jobs.filter(job=>!isClosed(job) && job.truckOnSite && same(job.onsiteTruck || job.truck));
  const lastSeen=jobs.find(job=>!isClosed(job) && !job.truckOnSite && job.lastSeenOnsiteTruck && same(job.lastSeenOnsiteTruck));
  const job=onsite[0] || lastSeen || assigned.find(job=>!isClosed(job) && !departed(job));
  if (!job) return null;
  const state=onsite.length>1 ? 'ambiguous' : onsite.length ? 'on_site' : lastSeen ? 'last_seen' : assignmentNeedsVerification(job) ? 'unverified' : job.appointmentStartMinutes===null ? 'untimed' : 'next';
  return {job,state,between:assigned.some(departed)};
}
export function freshTruckGps(truck:Pick<ScheduleTruck,'lastGpsUpdate'|'latitude'|'longitude'>|undefined, now=Date.now()) {
  const at=Date.parse(truck?.lastGpsUpdate || '');
  return Boolean(truck && truck.latitude!==null && truck.longitude!==null && Number.isFinite(truck.latitude) && Number.isFinite(truck.longitude) && Math.abs(truck.latitude)<=90 && Math.abs(truck.longitude)<=180 && Number.isFinite(at) && at<=now && now-at<=LINXUP_V3_AUTHORITY_MAX_AGE_SECONDS*1000);
}
// Parked heartbeat tolerance describes the last report; it never makes an
// older position eligible for a live ETA or confirms continued on-site presence.
export function truckProgressGpsState(truck:ScheduleTruck|undefined, now=Date.now()) {
  const at=Date.parse(truck?.lastGpsUpdate || '');
  if (!truck || truck.latitude==null || truck.longitude==null || !Number.isFinite(truck.latitude) || !Number.isFinite(truck.longitude) || Math.abs(truck.latitude)>90 || Math.abs(truck.longitude)>180 || !Number.isFinite(at) || at>now) return 'gps_unavailable';
  if (truckGpsStatus(truck,now).status==='Parked') return 'parked';
  return freshTruckGps(truck,now) ? 'fresh' : 'stale_gps';
}
export type TruckProgress = {truck:string; appointmentId:string; appointmentVersion:string; status:string; minutes:number|null; miles:number|null; gpsAt:string|null; calculatedAt:string; arrivalAt:string|null};
