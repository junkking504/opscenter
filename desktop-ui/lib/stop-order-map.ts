import type {ScheduleAppointment,ScheduleRouteLeg} from './schedule-contract';
export const routePointValid=(p:{latitude:number;longitude:number}|null|undefined):p is {latitude:number;longitude:number}=>Boolean(p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&(p.latitude!==0||p.longitude!==0));
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
