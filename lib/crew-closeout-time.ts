import type { ScheduleTruckVisit } from './schedule-visit-intervals';
import { chicagoDateKey } from './chicago-date';
import { closeoutClockFields, closeoutGpsTimes, type CloseoutTimeKey } from './closeout-draft-summary';

type Job = {truck:string;truckVisits?:ScheduleTruckVisit[]};
const truckKey=(truck:string)=>truck.match(/\d+/)?.[0]?.replace(/^0+/, '') || '';
/** Only appointment-scoped, confirmed GPS visits for the assigned truck qualify. */
export function crewCloseoutArrival(job:Job,truck:string,date:string,now=Date.now()):string|null {
  if(!truckKey(truck) || truckKey(job.truck)!==truckKey(truck))return null;
  const arrivals=(job.truckVisits || []).filter(visit=>truckKey(visit.truck)===truckKey(truck))
    .map(visit=>Date.parse(visit.arrival)).filter(stamp=>Number.isFinite(stamp) && stamp<=now && chicagoDateKey(new Date(stamp))===date);
  return arrivals.length?new Date(Math.min(...arrivals)).toISOString():null;
}
export function crewCloseoutTimes(job:Job,truck:string,date:string,submittedAt:string,fields:Parameters<typeof closeoutGpsTimes>[4],manual:Record<string,unknown>={}):Record<CloseoutTimeKey,string> {
  const end=Date.parse(submittedAt),arrival=crewCloseoutArrival(job,truck,date,end);
  if(!Number.isFinite(end) || chicagoDateKey(new Date(end))!==date || (arrival && end<=Date.parse(arrival)))throw new Error('The closeout time must follow arrival on this service day. Contact dispatch to review the job times.');
  let times:Partial<Record<CloseoutTimeKey,string>>;
  if(arrival)times=closeoutGpsTimes({arrival,departure:submittedAt,minutes:null,label:''},truck,truck,date,fields);
  else {
    const hour=manual.actualStartHour,minute=manual.actualStartMinute;
    const valid=(value:unknown,key:'actualStartHour'|'actualStartMinute',max:number)=>typeof value==='string' && /^\d{1,2}$/.test(value) && Number(value)<=max && fields[key].options.some(option=>option.value===value);
    if(!valid(hour,'actualStartHour',23) || !valid(minute,'actualStartMinute',59))throw new Error('GPS arrival is unavailable. Enter the actual arrival time before submitting closeout.');
    const clock=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(end)).map(part=>[part.type,part.value]));
    if(Number(hour)*60+Number(minute)>Number(clock.hour)*60+Number(clock.minute))throw new Error('Arrival time cannot be later than closeout. Check the manually entered start time.');
    times={actualStartHour:hour as string,actualStartMinute:minute as string,...closeoutClockFields(submittedAt,'actualEndHour','actualEndMinute',date,fields)};
  }
  if(!(['actualStartHour','actualStartMinute','actualEndHour','actualEndMinute'] as const).every(key=>times[key]!==undefined))throw new Error('JunkWare’s job-time options could not represent the recorded arrival and closeout times.');
  return times as Record<CloseoutTimeKey,string>;
}
