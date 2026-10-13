import type {AppointmentOnsiteTime} from './appointment-onsite-time';
import type {TruckGpsRoute} from '../desktop-ui/lib/gps-route-contract';
import type {ScheduleOperationalStop} from '../desktop-ui/lib/schedule-contract';
import {sameTruck} from './junkware-trucks';
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
