import {scheduleMapLocation} from './schedule-contract';
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
 const stops=jobs.flatMap((job,index)=>{const point=scheduleMapLocation(job);return routePointValid(point)?[{job,number:index+1,point}]:[];});
 const paths=jobs.slice(1).flatMap((job,index)=>{
  const from=jobs[index];
  if(!routePointValid(scheduleMapLocation(from))||!routePointValid(scheduleMapLocation(job)))return [];
  const leg=legs.find(row=>row.fromAppointmentId===from.recordId&&row.toAppointmentId===job.recordId);
  return leg?.source==='osm_road_estimate'&&leg.geometry&&leg.geometry.length>=2&&leg.geometry.every(routePointValid)?[{leg,from:index+1,to:index+2,points:leg.geometry}]:[];
 });
 return {stops,paths,missingPins:jobs.length-stops.length,missingRoutes:Math.max(0,jobs.length-1-paths.length)};
}

export type TruckBadgeRect = {left:number;top:number;width:number;height:number};
export type TruckBadgePoint = { id:string; x:number; y:number; selected:boolean; stale:boolean };
/** Screen-only badge placement. GPS points, route geometry and stop pins never move. */
export function stopOrderTruckBadges(points:TruckBadgePoint[],size:{x:number;y:number},blocked:TruckBadgeRect[]=[],gridOnly=false):Array<TruckBadgePoint & {left:number;top:number;width:number;height:number}> {
 let needsPacking=false;
 const placed:TruckBadgeRect[]=[...blocked];
 const result=[...points].sort((a,b)=>Number(b.selected)-Number(a.selected)||a.id.localeCompare(b.id,undefined,{numeric:true})).map(point=>{
  const width=94,height=point.stale?40:28,gap=8;
  const preferred={left:point.x-width/2,top:point.y-height-10,width,height};
  // Preserve offscreen positions in a dispatcher-chosen viewport.
  if(point.x<0||point.x>size.x||point.y<0||point.y>size.y)return {...point,...preferred};
  const candidates=gridOnly?[]:[preferred];
  for(let top=gap;top+height<=size.y-gap;top+=48)
   for(let left=gap;left+width<=size.x-gap;left+=102)candidates.push({left,top,width,height});
  candidates.sort((a,b)=>(a.left-preferred.left)**2+(a.top-preferred.top)**2-((b.left-preferred.left)**2+(b.top-preferred.top)**2));
  const position=candidates.find(rect=>rect.left>=gap&&rect.top>=gap&&rect.left+width<=size.x-gap&&rect.top+height<=size.y-gap&&placed.every(other=>rect.left>=other.left+other.width+gap||other.left>=rect.left+width+gap||rect.top>=other.top+other.height+gap||other.top>=rect.top+height+gap))||preferred;
  if(position===preferred&&placed.some(other=>!(position.left>=other.left+other.width+gap||other.left>=position.left+width+gap||position.top>=other.top+other.height+gap||other.top>=position.top+height+gap)))needsPacking=true;
  placed.push(position);
  return {...point,...position};
 });
 return needsPacking&&!gridOnly?stopOrderTruckBadges(points,size,blocked,true):result;
}
