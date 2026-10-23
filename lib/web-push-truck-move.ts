import type {PushSchedule} from './web-push-schedule';

export type TruckMove = {identity:string;observedAt:string;previous:PushSchedule|null;current:PushSchedule|null};
const truck=(value:unknown):string|null=>{
 if(typeof value!=='string')return null;
 if(!value.trim()||/^(?:Truck\s*#?\s*)?Virtual Truck$/i.test(value.trim()))return '';
 const match=value.trim().match(/^Truck\s*#?\s*([1-9][0-9]?)$/i);return match?match[1]:null;
};
/** Canonical producer marks exact changed facts; no parsing of display prose. */
export function isTruckOnlyMove(input:TruckMove):boolean {
 const a=input.previous,b=input.current;
 return Boolean(a&&b&&b.changedFields?.length===1&&b.changedFields[0]==='truck'
  &&a.date===b.date&&a.time===b.time&&a.status===b.status&&a.type===b.type&&a.label===b.label
  &&truck(a.truck)!==null&&truck(b.truck)!==null&&truck(a.truck)!==truck(b.truck));
}
/** Only the explicitly selected owner's delivery is omitted, regardless of actor.
 * No global category toggle, source mutation, receipt lookup or Waypoint effect. */
export function truckMoveOwner(input:TruckMove,owner:string|undefined):string|null {
 return owner&&isTruckOnlyMove(input)?owner:null;
}
