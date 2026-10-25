export type WaypointUpdateCounts={added:number;removed:number;timing:number;completed:number;details:number;messages:number;schedule:number};
export const emptyWaypointUpdates=():WaypointUpdateCounts=>({added:0,removed:0,timing:0,completed:0,details:0,messages:0,schedule:0});
export function waypointUpdateCounts(value:unknown):WaypointUpdateCounts {
 const result=emptyWaypointUpdates();
 if(value && typeof value==='object')for(const key of Object.keys(result) as Array<keyof WaypointUpdateCounts>){const count=(value as Record<string,unknown>)[key];if(typeof count==='number'&&Number.isInteger(count)&&count>0)result[key]=Math.min(count,1000);}
 return result;
}
export function waypointUpdateLabels(value:unknown):string[] {
 const count=waypointUpdateCounts(value);
 return [count.added&&`${count.added} appointment${count.added===1?'':'s'} added`,count.removed&&`${count.removed} appointment${count.removed===1?'':'s'} removed or canceled`,count.timing&&'Appointment time or route order changed',count.completed&&`${count.completed} appointment${count.completed===1?'':'s'} completed`,count.details&&'Assignment details updated',count.messages&&`${count.messages} new office message${count.messages===1?'':'s'}`,count.schedule&&'Schedule updated'].filter(Boolean) as string[];
}
