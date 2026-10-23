import {scheduleDisplayTruck,type ScheduleAppointment,type ScheduleTruck} from '../desktop-ui/lib/schedule-contract';
import {truckNumber} from './junkware-trucks';
import {costOnsiteMinutes} from './appointment-cost-recorded';

// Project the card's verified truck into cost planning without changing source assignments.
export function appointmentCostRoute<T extends ScheduleAppointment>(jobs:T[]):T[]{
 return jobs.map(job=>({...job,truck:scheduleDisplayTruck(job)}));
}
export function appointmentCostOnsite(job:ScheduleAppointment){
 return [job.onsiteTime,job.recordedOnsiteTime].find(time=>costOnsiteMinutes(time,job.truck)!==null);
}

// Select by geographic GPS distance without queuing fleet-wide road tables.
// The selected truck's two road legs still provide all cost mileage and time.
export function closestCostTruck(point:{latitude:number;longitude:number}|null,trucks:ScheduleTruck[],isToday:boolean){
 const valid=(p:{latitude:number|null;longitude:number|null})=>p.latitude!==null&&p.longitude!==null&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&!(p.latitude===0&&p.longitude===0);
 if(!isToday||!point||!valid(point))return null;
 const radians=(n:number)=>n*Math.PI/180;
 const distance=(truck:ScheduleTruck)=>{
  const a=Math.sin(radians(truck.latitude!-point.latitude)/2)**2+Math.cos(radians(point.latitude))*Math.cos(radians(truck.latitude!))*Math.sin(radians(truck.longitude!-point.longitude)/2)**2;
  return 2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,a))));
 };
 const truck=trucks.filter(truck=>truckNumber(truck.truck)&&valid(truck)&&!/out[ _-]of[ _-]service/i.test(`${truck.serviceStatus} ${truck.operationalStatus}`))
  .sort((a,b)=>distance(a)-distance(b)||a.truck.localeCompare(b.truck))[0];
 return truck?{truck:truck.truck,position:{latitude:truck.latitude!,longitude:truck.longitude!},gpsUpdatedAt:truck.lastGpsUpdate}:null;
}
