import type { ScheduleTruckVisit } from './schedule-visit-intervals';
import { chicagoDateKey } from './chicago-date';
import { closeoutGpsTimes, type CloseoutTimeKey } from './closeout-draft-summary';

type Job = {truck:string;truckVisits?:ScheduleTruckVisit[]};
const truckKey=(truck:string)=>truck.match(/\d+/)?.[0]?.replace(/^0+/, '') || '';
/** Only appointment-scoped, confirmed GPS visits for the assigned truck qualify. */
export function crewCloseoutArrival(job:Job,truck:string,date:string,now=Date.now()):string|null {
  if(!truckKey(truck) || truckKey(job.truck)!==truckKey(truck))return null;
  const arrivals=(job.truckVisits || []).filter(visit=>truckKey(visit.truck)===truckKey(truck))
    .map(visit=>Date.parse(visit.arrival)).filter(stamp=>Number.isFinite(stamp) && stamp<=now && chicagoDateKey(new Date(stamp))===date);
  return arrivals.length?new Date(Math.min(...arrivals)).toISOString():null;
}
export function crewCloseoutTimes(job:Job,truck:string,date:string,submittedAt:string,fields:Parameters<typeof closeoutGpsTimes>[4]):Record<CloseoutTimeKey,string> {
  const end=Date.parse(submittedAt),arrival=crewCloseoutArrival(job,truck,date,end);
  if(!arrival)throw new Error('The assigned truck’s on-site arrival has not been confirmed. Refresh or contact dispatch before submitting closeout.');
  if(!Number.isFinite(end) || end<=Date.parse(arrival) || chicagoDateKey(new Date(end))!==date)throw new Error('The closeout time must follow arrival on this service day. Contact dispatch to review the job times.');
  const times=closeoutGpsTimes({arrival,departure:submittedAt,minutes:null,label:''},truck,truck,date,fields);
  if(!(['actualStartHour','actualStartMinute','actualEndHour','actualEndMinute'] as const).every(key=>times[key]!==undefined))throw new Error('JunkWare’s job-time options could not represent the recorded arrival and closeout times.');
  return times as Record<CloseoutTimeKey,string>;
}
