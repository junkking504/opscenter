import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scheduleInterval, type PushSchedule } from './web-push-schedule';

export type SelfMove = {identity:string;observedAt:string;previous:PushSchedule|null;current:PushSchedule|null};
type Receipt = Record<string, any>;
const windowMs=15*60_000;
const truck=(value:unknown):string|null=>{
 if(typeof value!=='string')return null;
 if(!value.trim()||/^(?:Truck\s*#?\s*)?Virtual Truck$/i.test(value.trim()))return '';
 const match=value.trim().match(/^Truck\s*#?\s*([1-9][0-9]?)$/i);return match?match[1]:null;
};
/** Canonical producer marks exact changed facts; no parsing of display prose. */
export function isTruckOnlyMove(input:SelfMove):boolean {
 const a=input.previous,b=input.current;
 return Boolean(a&&b&&b.changedFields?.length===1&&b.changedFields[0]==='truck'
  &&a.date===b.date&&a.time===b.time&&a.status===b.status&&a.type===b.type&&a.label===b.label
  &&!/^(completed|closed|cancelled|canceled|removed|deleted)\b/i.test(b.status)
  &&truck(a.truck)!==null&&truck(b.truck)!==null&&truck(a.truck)!==truck(b.truck));
}
/** A unique server-authenticated, source-verified receipt, never a guessed actor. */
export function selfMoveOwner(input:SelfMove,receipts:unknown[],optedInOwner:string|undefined):string|null {
 if(!optedInOwner||!isTruckOnlyMove(input))return null;
 const before=input.previous!,after=input.current!,at=Date.parse(input.observedAt),times=scheduleInterval(after.time);
 if(!Number.isFinite(at)||!times||times.length!==2)return null;
 const matches=receipts.filter((value):value is Receipt=>{
  if(!value||typeof value!=='object')return false;const r=value as Receipt,j=r.sourceResult?.junkware;
  if(r.action!=='move'||r.status!=='verified'||r.date!==after.date||typeof r.actor!=='string'||!j||j.changed!==true)return false;
  if(typeof j.appointmentId!=='string'||!/^\d{1,12}$/.test(j.appointmentId)||r.recordId!==`${after.date}:appointment:${j.appointmentId}`||j.date!==after.date)return false;
  const identity=createHash('sha256').update(JSON.stringify(j.appointmentId)+'\n').digest('hex');
  const created=Date.parse(r.createdAt),verified=Date.parse(j.verifiedAt),finished=Date.parse(r.updatedAt);
  return identity===input.identity&&Number.isFinite(created)&&Number.isFinite(verified)&&Number.isFinite(finished)
   &&created<=verified&&verified<=finished&&finished<=at&&at-created<=windowMs
   &&truck(j.previousTruck)===truck(before.truck)&&truck(j.truck)===truck(after.truck)
   &&j.previousAppointmentStartMinutes===times[0]&&j.appointmentStartMinutes===times[0]&&j.appointmentEndMinutes===times[1];
 });
 return matches.length===1&&matches[0].actor===optedInOwner?optedInOwner:null;
}
/** Bounded read of existing private receipts. Any uncertainty leaves delivery on.
 * No source lookup, receipt mutation, delay, replay or polling is introduced. */
export async function readSelfMoveOwner(input:SelfMove,owner=process.env.OPSCENTER_WEB_PUSH_SELF_MOVE_OWNER,
 directory=process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR||path.join(process.cwd(),'data','desktop-operations')):Promise<string|null> {
 if(!owner||!isTruckOnlyMove(input))return null;
 try {
  const files=(await fs.readdir(directory)).filter(name=>/^[a-f0-9-]{36}\.json$/i.test(name));
  if(files.length>2000)return null;
  const receipts:unknown[]=[];const at=Date.parse(input.observedAt);
  for(const name of files){
   const file=path.join(directory,name),info=await fs.lstat(file);
   if(info.mtimeMs<at-windowMs)continue;
   if(!info.isFile()||info.isSymbolicLink()||info.size>65536)return null;
   const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
   try {const raw=await handle.readFile();if(raw.length>65536)return null;receipts.push(JSON.parse(raw.toString('utf8')));}
   finally {await handle.close();}
  }
  return selfMoveOwner(input,receipts,owner);
 }catch{return null;}
}
