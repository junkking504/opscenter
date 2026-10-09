import type {ScheduleAppointment,ScheduleRouteLeg,ScheduleSnapshot} from './schedule-contract';
import {sameTruck,truckDisplayLabel} from '../../lib/junkware-trucks';
import {truckGpsStatus} from '../../lib/truck-gps-status';
export const routePointValid=(p:{latitude:number;longitude:number}|null|undefined):p is {latitude:number;longitude:number}=>Boolean(p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&(p.latitude!==0||p.longitude!==0));
/** Today's reported positions only; a stale fix remains explicitly last known. */
export function stopOrderTrucks(fleet:ScheduleSnapshot['fleet'],selectedTruck:string,now=Date.now()) {
 return (fleet.isToday?fleet.trucks:[]).flatMap(truck=>{
  if(truck.latitude===null||truck.longitude===null)return [];
  const point={latitude:truck.latitude,longitude:truck.longitude};
  if(!routePointValid(point))return [];
  const gps=truckGpsStatus(truck,now),observed=Date.parse(truck.lastGpsUpdate||'');
  const reportedAt=Number.isFinite(observed)?new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(observed):'Time unavailable';
  return [{truck,point,gps,reportedAt,label:truckDisplayLabel(truck.truck),selected:sameTruck(truck.truck,selectedTruck)}];
 });
}
/** Only draw road geometry for adjacent stops in the current draft. Missing
 * pins or unavailable legs stay disconnected, never bridged with a guess. */
export function stopOrderMap(jobs:ScheduleAppointment[],legs:ScheduleRouteLeg[]) {
 const stops=jobs.flatMap((job,index)=>routePointValid(job.location)?[{job,number:index+1,point:job.location}]:[]);
 const paths=jobs.slice(1).flatMap((job,index)=>{
  const from=jobs[index];
  if(!routePointValid(from.location)||!routePointValid(job.location))return [];
  const leg=legs.find(row=>row.fromAppointmentId===from.recordId&&row.toAppointmentId===job.recordId);
  return leg?.source==='osm_road_estimate'&&leg.geometry&&leg.geometry.length>=2&&leg.geometry.every(routePointValid)?[{leg,from:index+1,to:index+2,points:leg.geometry}]:[];
 });
 return {stops,paths,missingPins:jobs.length-stops.length,missingRoutes:Math.max(0,jobs.length-1-paths.length)};
}
