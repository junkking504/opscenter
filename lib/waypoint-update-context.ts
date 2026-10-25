export type WaypointUpdateCounts={added:number;removed:number;timing:number;completed:number;details:number;messages:number;schedule:number};
export const emptyWaypointUpdates=():WaypointUpdateCounts=>({added:0,removed:0,timing:0,completed:0,details:0,messages:0,schedule:0});
export type WaypointJobChange={appointmentId:string;kind:'added'|'removed'|'time'|'route'|'reopened';before?:string;after?:string};
export function waypointJobChanges(value:unknown):WaypointJobChange[] {
 if(!Array.isArray(value))return [];
 return value.slice(0,200).flatMap(item=>{
  if(!item||typeof item!=='object'||typeof item.appointmentId!=='string'||!/^\d{1,12}$/.test(item.appointmentId)||!['added','removed','time','route','reopened'].includes(item.kind))return [];
  const time=(v:unknown)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,100):undefined;
  return [{appointmentId:item.appointmentId,kind:item.kind,...(time(item.before)?{before:time(item.before)}:{}),...(time(item.after)?{after:time(item.after)}:{})}];
 });
}
export function waypointJobChangeLabel(change:WaypointJobChange):string {
 if(change.kind==='time')return `Time changed: ${change.before||'Previously unavailable'} → ${change.after||'Check current route'}`;
 return {added:'Added to your route',removed:'No longer on your route',route:'Route order changed',reopened:'Reopened on your route'}[change.kind];
}
export function waypointUpdateCounts(value:unknown):WaypointUpdateCounts {
 const result=emptyWaypointUpdates();
 if(value && typeof value==='object')for(const key of Object.keys(result) as Array<keyof WaypointUpdateCounts>){const count=(value as Record<string,unknown>)[key];if(typeof count==='number'&&Number.isInteger(count)&&count>0)result[key]=Math.min(count,1000);}
 return result;
}
export function waypointUpdateLabels(value:unknown):string[] {
 const count=waypointUpdateCounts(value);
 return [count.added&&`${count.added} appointment${count.added===1?'':'s'} added`,count.removed&&`${count.removed} appointment${count.removed===1?'':'s'} removed or canceled`,count.timing&&'Appointment time or route order changed',count.completed&&`${count.completed} appointment${count.completed===1?'':'s'} completed`,count.details&&'Assignment details updated',count.messages&&`${count.messages} new office message${count.messages===1?'':'s'}`,count.schedule&&'Schedule updated'].filter(Boolean) as string[];
}
/** Lock-screen context is categories/counts only. Job references stay behind sign-in. */
export function waypointNotificationMessage(truck:string,value:unknown,id:string) {
 const labels=waypointUpdateLabels(value);
 return {title:`Waypoint · ${/^Truck \d{1,2}$/.test(truck)?truck:'Your truck'}`,body:`${labels.join(' · ')||'Route update'}. Tap to review.`,path:`/crew-jobs?view=updates&update=${id}`};
}
