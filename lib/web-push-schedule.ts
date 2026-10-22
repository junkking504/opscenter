import {pushMessage,pushPath,type PushMessage} from './web-push-message';

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
export function schedulePath(schedule:PushSchedule|null|undefined):string|undefined {
 const job=schedule?.label.split(' — ')[0];
 return schedule&&job&&/^JK[0-9]{1,12}$/i.test(job)?pushPath(`/jobs?date=${schedule.date}#job-${job.toLowerCase()}`):undefined;
}
const cancelled=(s:PushSchedule)=>/^(cancelled|canceled)$/i.test(s.status);
const removed=(s:PushSchedule)=>/^(removed|deleted)$/i.test(s.status);
const completed=(s:PushSchedule)=>/^(completed|closed)\b/i.test(s.status);
/** Parse only complete source clock labels; formatting changes are not moves.
 * Unknown/malformed timing cannot establish a destination. */
function interval(value:string):number[]|null {
 const parts=value.trim().split(/\s*[-–—]\s*/);
 if(parts.length<1||parts.length>2)return null;
 const times:number[]=[];
 for(const part of parts){
  const match=part.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if(!match||(!match[2]&&!match[3]))return null;
  let hour=Number(match[1]);const minute=Number(match[2]||0),period=match[3]?.toUpperCase();
  if(minute>59||(period?(hour<1||hour>12):hour>23))return null;
  if(period)hour=hour%12+(period==='PM'?12:0);
  times.push(hour*60+minute);
 }
 return times;
}
const when=(s:PushSchedule)=>`${s.date}, ${s.time||'Time not verified'} (Central)`;
function moved(a:PushSchedule,b:PushSchedule):boolean {
 if(cancelled(a)||cancelled(b)||removed(a)||removed(b)||completed(a)||completed(b))return false;
 const before=interval(a.time),after=interval(b.time);
 if(!after)return false;
 return a.date!==b.date||Boolean(before&&(before[0]!==after[0]||
  (before.length===2&&after.length===2&&before[1]!==after[1])));
}
export type SchedulePeer={scope:string;present:boolean;observed_at:Date|string;source_observed_at:Date|string;notification_json:unknown};
/** Fresh, unique, verified destination plus a verified disappearance is required.
 * The other scope's transition and latest read must be within 15 minutes; no lookups,
 * new collection, delivery delay or polling is introduced. Ambiguity stays unknown. */
export function scheduleCounterpart(peers:SchedulePeer[],at:string,present:boolean):PushSchedule|null {
 const candidates=peers.flatMap(row=>{
  const age=Date.parse(at)-new Date(row.source_observed_at).getTime();
  const transitionAge=Date.parse(at)-new Date(row.observed_at).getTime();
  const notification=row.notification_json as {schedule?:unknown};
  const schedule=pushSchedule(notification?.schedule);
  // Both the transition and current source read must be recent. A partial or
  // unchanged later read cannot refresh an old location/removal into evidence.
  if(!(age>=0&&age<=15*60000)||!(transitionAge>=0&&transitionAge<=15*60000))return [];
  return [{present:row.present,schedule:schedule&&row.scope.split(':')[1]===schedule.date?{...schedule,details:pushMessage(notification)?.body}:null}];
 });
 // Check uniqueness before choosing present/absent or status: contradictory
 // locations/statuses must never disappear merely because they are not wanted.
 const candidate=candidates.length===1?candidates[0]:null;
 return candidate&&candidate.schedule&&candidate.present===present&&!cancelled(candidate.schedule)&&!removed(candidate.schedule)&&!completed(candidate.schedule)?candidate.schedule:null;
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
  // The canonical producer formats semantic completion transitions. A changed
  // time/truck at completion must not replace that meaning with Rescheduled.
  if(completed(current)&&fallback)return fallback;
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
