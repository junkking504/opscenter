import type {AppointmentOnsiteTime} from './appointment-onsite-time';
import type {TruckGpsRoute} from '../desktop-ui/lib/gps-route-contract';
import type {ScheduleOperationalStop} from '../desktop-ui/lib/schedule-contract';
import {sameTruck} from './junkware-trucks';
import {chicagoDateKey} from './report-dates';
export function costOnsiteMinutes(time:AppointmentOnsiteTime|undefined,truck:string){
 if(!time||!sameTruck(time.truck,truck)||time.minutes===null||!Number.isFinite(time.minutes)||time.minutes<0)return null;
 const start=Date.parse(time.arrival||''),end=Date.parse(time.departure||'');
 return Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end<=Date.now()?time.minutes:null;
}
export function recordedCostTransfer(from:AppointmentOnsiteTime|undefined,to:AppointmentOnsiteTime|undefined,truck:string,route:TruckGpsRoute,stops:ScheduleOperationalStop[]){
 if(costOnsiteMinutes(from,truck)===null||costOnsiteMinutes(to,truck)===null)return null;
 const start=Date.parse(from!.departure!),end=Date.parse(to!.arrival!);
 if(end<=start)return null;
 // Never count a known dump/warehouse stop as direct appointment travel.
 if(stops.some(stop=>sameTruck(stop.truck,truck)&&Date.parse(stop.enteredAt||'')<end&&Date.parse(stop.departedAt||stop.observedThrough)>start))return null;
 // Continuous, plausible GPS coverage must span the recorded transfer.
 const covered=route.paths.some(run=>run.length>1&&Date.parse(run[0].timestamp)<=start+120000&&Date.parse(run[run.length-1].timestamp)>=end-120000);
 return covered?(end-start)/60000:null;
}

// Replace a synthetic first warehouse leg only with a uniquely matched physical
// trip into this appointment. The trip must agree with the recorded visit time
// and location; today's truck position cannot rewrite a past trip.
export function recordedCostArrival(job:{truck:string;truckVisits?:{truck:string;arrival:string}[]},point:{latitude:number;longitude:number}|null,route:TruckGpsRoute,now=Date.now()){
 if(!point||!sameTruck(job.truck,route.truck))return null;
 const arrival=Math.min(...(job.truckVisits||[]).filter(v=>sameTruck(v.truck,job.truck)).map(v=>Date.parse(v.arrival)).filter(n=>Number.isFinite(n)&&n<=now));
 if(!Number.isFinite(arrival)||chicagoDateKey(new Date(arrival))!==route.date)return null;
 const distance=(p:{latitude:number;longitude:number})=>{
  if(!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180)return Infinity;
  const rad=Math.PI/180;
  const a=Math.sin((p.latitude-point.latitude)*rad/2)**2+Math.cos(point.latitude*rad)*Math.cos(p.latitude*rad)*Math.sin((p.longitude-point.longitude)*rad/2)**2;
  return 12742000*Math.asin(Math.sqrt(Math.min(1,a)));
 };
 const candidates=(route.trips||[]).filter(trip=>{
  const start=Date.parse(trip.departure),end=Date.parse(trip.arrival);
  return Number.isFinite(start)&&Number.isFinite(end)&&end<=now&&chicagoDateKey(new Date(start))===route.date&&start<arrival&&end>start&&end-start<=3*3600000&&Math.abs(end-arrival)<=5*60000&&distance(trip.to)<=200&&distance(trip.from)>=400&&distance(trip.from)<Infinity;
 });
 if(candidates.length!==1)return null;
 const trip=candidates[0];
 return {position:trip.from,label:trip.from.address||'Recorded GPS stop',minutes:(Date.parse(trip.arrival)-Date.parse(trip.departure))/60000,departure:trip.departure,arrival:trip.arrival};
}
