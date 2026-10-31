import type {CrewScheduledJob} from './crew-dispatch';
import type {DesktopAppointment} from './desktop-schedule';
import {truckNumber,truckDisplayText} from './junkware-trucks';

export type WaypointMapAppointment={
 id:string;customerName:string;address:string;truck:string;status:string;label:string;
 location:{latitude:number;longitude:number;approximate:boolean}|null;
};
export function waypointMapStatus(status:string):'active'|'completed'|'cancelled' {
 if(/^cancel(?:led|ed)\b/i.test(status.trim()))return 'cancelled';
 if(/^(?:completed|closed)\b/i.test(status.trim()))return 'completed';
 return 'active';
}
export function hasMapLocation(row:WaypointMapAppointment):boolean {
 const p=row.location;
 return Boolean(p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180);
}
/** Group map points whose screen positions are within `minDistance` pixels so pins never overlap.
 * Single-linkage first (any chain of close points is one group), then groups whose rendered
 * marker, drawn at the group's average position, would sit closer than `minDistance` to another
 * group's marker are merged, repeating until every pair of markers is separated. Groups and
 * members keep input order. */
export function clusterByScreenDistance<T>(points:{x:number;y:number;item:T}[],minDistance:number):T[][] {
 let groups:number[][]=points.map((_,index)=>[index]);
 const center=(group:number[])=>({x:group.reduce((sum,i)=>sum+points[i].x,0)/group.length,y:group.reduce((sum,i)=>sum+points[i].y,0)/group.length});
 const mergeFirstCollision=(close:(a:number[],b:number[])=>boolean)=>{
  for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
   if(close(groups[i],groups[j])){groups=[...groups.slice(0,i),[...groups[i],...groups[j]].sort((a,b)=>a-b),...groups.slice(i+1,j),...groups.slice(j+1)];return true;}
  }
  return false;
 };
 while(mergeFirstCollision((a,b)=>a.some(i=>b.some(j=>Math.hypot(points[i].x-points[j].x,points[i].y-points[j].y)<minDistance))));
 while(mergeFirstCollision((a,b)=>{const p=center(a),q=center(b);return Math.hypot(p.x-q.x,p.y-q.y)<minDistance;}));
 return groups.map(group=>group.map(index=>points[index].item));
}
function mapLabel(truck:string,status:string,position:number) {
 const number=truckNumber(truck),prefix=number===null?'U':`T${number}`;
 const state=waypointMapStatus(status);
 return `${prefix}${state==='completed'?'✓':state==='cancelled'?'×':`·${position}`}`;
}
/** The server owns visibility. Project every supplied appointment without widening scope. */
export function crewMapAppointments(jobs:CrewScheduledJob[]):WaypointMapAppointment[] {
 const counts=new Map<string,number>();
 return jobs.map(job=>{
  const truck=job.truck || '',key=String(truckNumber(truck) ?? 'unassigned');
  const position=(counts.get(key)||0)+(waypointMapStatus(job.status)==='active'?1:0);
  counts.set(key,position);
  return {id:job.appointmentId,customerName:job.customerName,address:job.address,truck:truckDisplayText(truck)||'Unassigned',status:job.status,
   label:mapLabel(truck,job.status,job.routePosition ?? position),location:job.mapLocation || null};
 });
}
/** Use the same saved coordinates/fallback as OpsCenter; never geocode from this view. */
export function managerMapAppointments(jobs:DesktopAppointment[]):WaypointMapAppointment[] {
 const counts=new Map<string,number>();
 return jobs.map(job=>{
  const truck=job.truck || '',key=String(truckNumber(truck) ?? 'unassigned'),position=(counts.get(key)||0)+1;
  counts.set(key,position);
  const point=job.location || job.mapFallback?.location;
  return {id:job.recordId,customerName:job.customerName,address:job.address,truck:truckNumber(truck)===null?'Unassigned':truckDisplayText(truck),status:job.status,
   label:mapLabel(truck,job.status,job.visitOrder===undefined?position:job.visitOrder+1),
   location:point?{...point,approximate:!job.location}:null};
 });
}
