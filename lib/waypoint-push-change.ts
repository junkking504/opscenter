import {createHash} from 'node:crypto';
import {emptyWaypointUpdates,type WaypointUpdateCounts} from './waypoint-update-context';
type Job={appointmentId:string;status:string;appointmentTime:string;address:string;appointmentNotes:string[];junkItems:string[];routePosition?:number;customerName?:string;phone?:string;driver?:string;navigator?:string};
export type WaypointPushProjection={jobs:Array<{id:string;status:string;time:string;position:number|null;details:string}>;messages:string[]};
const text=(value:unknown)=>String(value??'').replace(/\s+/g,' ').trim();
export function waypointPushProjection(jobs:Job[],messages:Array<{id:string}>):WaypointPushProjection {
 return {jobs:jobs.map(job=>({id:job.appointmentId,status:text(job.status),time:text(job.appointmentTime),position:job.routePosition??null,details:createHash('sha256').update(JSON.stringify([job.address,job.customerName,job.phone,job.driver,job.navigator].map(text).concat([...job.appointmentNotes].map(text).sort(),[...job.junkItems].map(text).sort()))).digest('hex')})).sort((a,b)=>a.id.localeCompare(b.id)),messages:messages.map(message=>message.id).sort()};
}
export function waypointPushChange(prior:WaypointPushProjection|null,next:WaypointPushProjection,kind:'schedule'|'messages'):{counts:WaypointUpdateCounts;urgent:boolean;changed:boolean} {
 const counts=emptyWaypointUpdates();
 // Older baselines have no projection. Preserve a real changed revision once;
 // subsequent comparisons use the bounded, non-sensitive projection.
 if(!prior){counts[kind==='messages'?'messages':'schedule']=1;return {counts,urgent:true,changed:true};}
 if(kind==='messages')counts.messages=next.messages.filter(id=>!prior.messages.includes(id)).length;
 else {
  const old=new Map(prior.jobs.map(job=>[job.id,job])),current=new Map(next.jobs.map(job=>[job.id,job]));
  counts.removed=prior.jobs.filter(job=>!current.has(job.id)).length;
  for(const job of next.jobs){const before=old.get(job.id);if(!before){counts.added++;continue;}
   if(before.time!==job.time||before.position!==job.position)counts.timing++;
   if(before.status!==job.status){if(job.status==='Completed')counts.completed++;else counts.schedule++;}
   if(before.details!==job.details)counts.details++;
  }
 }
 return {counts,urgent:Boolean(counts.added||counts.removed||counts.timing||counts.messages||counts.schedule),changed:Object.values(counts).some(Boolean)};
}
