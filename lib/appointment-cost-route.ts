import {scheduleDisplayTruck,type ScheduleAppointment,type ScheduleTruck,type ClosestTruck} from '../desktop-ui/lib/schedule-contract';
import {sameTruck,truckNumber} from './junkware-trucks';
import {costOnsiteMinutes} from './appointment-cost-recorded';

// Project the card's verified truck into cost planning without changing source assignments.
export function appointmentCostRoute<T extends ScheduleAppointment>(jobs:T[]):T[]{
 return jobs.map(job=>({...job,truck:scheduleDisplayTruck(job)}));
}
export function appointmentCostOnsite(job:ScheduleAppointment){
 return [job.onsiteTime,job.recordedOnsiteTime].find(time=>costOnsiteMinutes(time,job.truck)!==null);
}

// Use the map's road ETA ranking; unknown coordinates and explicit out-of-service trucks cannot be origins.
export function closestCostTruck(rows:ClosestTruck[],trucks:ScheduleTruck[]){
 const eligible=rows.filter(row=>row.status==='available'&&row.minutes!==null&&Number.isFinite(row.minutes)&&row.minutes>=0&&row.miles!==null&&Number.isFinite(row.miles)&&row.miles>=0)
  .sort((a,b)=>a.minutes!-b.minutes!||a.miles!-b.miles!||a.truck.localeCompare(b.truck));
 for(const row of eligible){
  const truck=trucks.find(truck=>sameTruck(truck.truck,row.truck));
  if(!truck||!truckNumber(truck.truck)||/out[ _-]of[ _-]service/i.test(`${truck.serviceStatus} ${truck.operationalStatus}`))continue;
  const {latitude,longitude}=truck;
  if(latitude===null||longitude===null||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180||(latitude===0&&longitude===0))continue;
  return {truck:truck.truck,position:{latitude,longitude},gpsUpdatedAt:row.gpsUpdatedAt};
 }
 return null;
}
