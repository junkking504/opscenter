import {pushMessage,type PushMessage} from './web-push-message';

/** Private presentation metadata retained with an observation, never encrypted
 * into the wire payload. Identity still comes from the canonical appointment ID. */
export type PushSchedule = {date:string;time:string;label:string;status:string;truck:string;type:string;details?:string};
export function pushSchedule(value:unknown):PushSchedule|null {
 const v=value as Partial<PushSchedule>|undefined;
 if(!v || typeof v.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date))return null;
 const date=new Date(v.date+'T12:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==v.date)return null;
 for(const key of ['time','label','status','truck','type'] as const)if(typeof v[key]!=='string'||v[key]!.length>200)return null;
 return {date:v.date,time:v.time!,label:v.label!,status:v.status!,truck:v.truck!,type:v.type!};
}
const cancelled=(s:PushSchedule)=>/^(cancelled|canceled)$/i.test(s.status);
const removed=(s:PushSchedule)=>/^(removed|deleted)$/i.test(s.status);
const timed=(s:PushSchedule)=>/(?:\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b(?:1[0-2]|[1-9])\s*(?:AM|PM)\b)/i.test(s.time)&&!/(unknown|unassigned|not verified|tbd)/i.test(s.time);
const when=(s:PushSchedule)=>`${s.date}, ${s.time||'Time not verified'} (Central)`;
const moved=(a:PushSchedule,b:PushSchedule)=>!cancelled(a)&&!cancelled(b)&&!removed(a)&&!removed(b)&&timed(b)&&(a.date!==b.date||(timed(a)&&a.time!==b.time));
export type SchedulePeer={scope:string;present:boolean;observed_at:Date|string;source_observed_at:Date|string;notification_json:unknown};
/** Fresh, unique, verified destination plus a verified disappearance is required.
 * The other scope's latest complete read must be within 15 minutes; no lookups,
 * new collection, delivery delay or polling is introduced. Ambiguity stays unknown. */
export function scheduleCounterpart(peers:SchedulePeer[],at:string,present:boolean):PushSchedule|null {
 const candidates=peers.filter(row=>row.present===present).flatMap(row=>{
  const age=Date.parse(at)-new Date(row.source_observed_at).getTime();
  const transitionAge=Date.parse(at)-new Date(row.observed_at).getTime();
  const notification=row.notification_json as {schedule?:unknown};
  const schedule=pushSchedule(notification?.schedule);
  // Absence must itself be recent, not an old tombstone refreshed by later reads.
  if(!(age>=0&&age<=15*60000)||(!present&&!(transitionAge>=0&&transitionAge<=15*60000))||
     !schedule||row.scope.split(':')[1]!==schedule.date||cancelled(schedule)||removed(schedule))return [];
  return [{...schedule,details:pushMessage(notification)?.body}];
 });
 return candidates.length===1?candidates[0]:null;
}
export function schedulePushMessage(input:{current?:PushSchedule|null;previous?:PushSchedule|null;peer?:PushSchedule|null;fallback?:PushMessage|null;removed?:boolean}):PushMessage {
 const {current,previous,peer,fallback}=input;
 if(input.removed){
  if(previous&&peer&&moved(previous,peer))return rescheduled(previous,peer,peer.details);
  if(previous&&cancelled(previous))return {title:'Cancelled',body:fallback?.body||`Date/time: ${when(previous)}\nJob: ${previous.label}\nCancellation confirmed by source.`};
  if(previous&&removed(previous))return {title:'Removed from schedule',body:fallback?.body||`Date/time: ${when(previous)}\nJob: ${previous.label}`};
  const warning='No longer listed. Cancellation or new date/time not verified.';
  const details=fallback?.body|| (previous?`Date: ${previous.date}\nTime: ${previous.time||'Not verified'} (Central)\nJob: ${previous.label}`:'Appointment');
  const lines=details.split('\n');
  // Keep the uncertainty above long optional details so truncation cannot hide it.
  if(previous&&details.startsWith('Date: '))lines.splice(2,0,warning);
  else lines.unshift(warning);
  return {title:'Schedule changed',body:lines.join('\n')};
 }
 if(current){
  if(cancelled(current))return {title:'Cancelled',body:fallback?.body||`${when(current)}\n${current.label}`};
  if(removed(current))return {title:'Removed from schedule',body:fallback?.body||`${when(current)}\n${current.label}`};
  const before=previous||peer;
  if(before&&moved(before,current))return rescheduled(before,current,fallback?.body);
 }
 return fallback||{title:'Schedule updated',body:'Open OpsCenter for the verified schedule details.'};
}
function rescheduled(before:PushSchedule,after:PushSchedule,details?:string):PushMessage {
 const [job,...customer]=after.label.split(' — ');
 const extra=(details?.startsWith('Date: ')?details.split('\n').slice(2):undefined) || [`Job: ${job}`,...(customer.length?[`Customer: ${customer.join(' — ')}`]:[]),...(after.truck?[`Truck: ${after.truck.replace(/^Truck /,'')}`]:[]),...(after.status?[`Status: ${after.status}`]:[]),...(after.type?[`Type: ${after.type}`]:[])];
 return {title:'Rescheduled',body:[`To: ${when(after)}`,`From: ${when(before)}`,...extra].join('\n')};
}
