import {createHash} from 'node:crypto';
import {emptyWaypointUpdates,type WaypointUpdateCounts,type WaypointJobChange} from './waypoint-update-context';
import {scheduleInterval} from './web-push-schedule';
type Job={appointmentId:string;status:string;appointmentTime:string;address:string;appointmentNotes:string[];junkItems:string[];routePosition?:number;customerName?:string;phone?:string;driver?:string;navigator?:string};
export type WaypointPushProjection={jobs:Array<{id:string;status:string;time:string;position:number|null;details:string}>;messages:string[]};
const text=(value:unknown)=>String(value??'').replace(/\s+/g,' ').trim();
export function waypointPushProjection(jobs:Job[],messages:Array<{id:string}>):WaypointPushProjection {
 return {jobs:jobs.map(job=>({id:job.appointmentId,status:text(job.status),time:text(job.appointmentTime),position:job.routePosition??null,details:createHash('sha256').update(JSON.stringify([job.address,job.customerName,job.phone,job.driver,job.navigator].map(text).concat([...job.appointmentNotes].map(text).sort(),[...job.junkItems].map(text).sort()))).digest('hex')})).sort((a,b)=>a.id.localeCompare(b.id)),messages:messages.map(message=>message.id).sort()};
}
export function waypointPushChange(prior:WaypointPushProjection|null,next:WaypointPushProjection,kind:'schedule'|'messages'):{counts:WaypointUpdateCounts;changes:WaypointJobChange[];urgent:boolean;changed:boolean} {
 const counts=emptyWaypointUpdates();
 const changes:WaypointJobChange[]=[];
 // Unknown old state cannot establish an actionable change. Seed silently.
 if(!prior)return {counts,changes,urgent:false,changed:false};
 if(kind==='messages')counts.messages=next.messages.filter(id=>!prior.messages.includes(id)).length;
 else {
  const old=new Map(prior.jobs.map(job=>[job.id,job])),current=new Map(next.jobs.map(job=>[job.id,job]));
  const active=(job:WaypointPushProjection['jobs'][number])=>job.status!=='Completed';
  const common=prior.jobs.filter(job=>active(job)&&current.has(job.id)&&active(current.get(job.id)!));
  const order=(jobs:WaypointPushProjection['jobs'])=>jobs.filter(job=>common.some(item=>item.id===job.id)).sort((a,b)=>a.position!-b.position!).map(job=>job.id);
  // Compare relative order, not numeric renumbering when a job is added/closed.
  const ordered=common.length>1&&common.every(job=>Number.isFinite(job.position)&&Number.isFinite(current.get(job.id)!.position))
   &&new Set(common.map(job=>job.position)).size===common.length&&new Set(common.map(job=>current.get(job.id)!.position)).size===common.length;
  const oldOrder=ordered?order(prior.jobs):[],newOrder=ordered?order(next.jobs):[];
  for(const job of prior.jobs)if(active(job)&&!current.has(job.id)){counts.removed++;changes.push({appointmentId:job.id,kind:'removed'});}
  for(const job of next.jobs){if(!active(job))continue;const before=old.get(job.id);if(!before){counts.added++;changes.push({appointmentId:job.id,kind:'added'});continue;}
   if(!active(before)){counts.schedule++;changes.push({appointmentId:job.id,kind:'reopened'});continue;}
   const beforeTime=scheduleInterval(before.time),afterTime=scheduleInterval(job.time);
   const timeChanged=beforeTime&&afterTime&&(beforeTime[0]!==afterTime[0]||(beforeTime.length===2&&afterTime.length===2&&beforeTime[1]!==afterTime[1]));
   const routeChanged=ordered&&oldOrder.indexOf(job.id)!==newOrder.indexOf(job.id);
   if(timeChanged){changes.push({appointmentId:job.id,kind:'time',before:before.time,after:job.time});}
   if(routeChanged)changes.push({appointmentId:job.id,kind:'route'});
   if(timeChanged||routeChanged)counts.timing++;
   // Source enrichment, notes, crew-name formatting and completion are visible
   // in the app; none warrants another interruption of the crew's work.
  }
 }
 return {counts,changes,urgent:Boolean(counts.messages),changed:Object.values(counts).some(Boolean)};
}
