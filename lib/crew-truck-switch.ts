import {truckSwitchStatus} from './crew-truck-switch-status';
import { sameTruck } from './junkware-trucks';
import {createHash,randomUUID} from 'node:crypto';
import type {CrewDispatch} from './crew-dispatch';
import {CrewPhoneError,type CrewPhone} from './crew-phone';
import {readCrewDay,requireCrewDay,saveCrewDay,crewDayRoster} from './crew-phone-day';
import {crewInspectionState} from './crew-phone-inspection';
import {JUNKWARE_DISPATCH_TRUCKS} from './junkware-trucks';
import {listCrewPhones} from './crew-phone-store';
import {readCrewDispatch,transferCrewDispatch} from './crew-dispatch-store';
import {crewScheduleFresh} from './crew-dispatch-service';
import {readDesktopSchedule,type DesktopAppointment} from './desktop-schedule';
import {readJunkwareTruckAssignment,syncJunkwareTruckAssignment} from './junkware-truck-assignment';
import {saveJobRouteAssignment,withScheduleOperationLock,withJunkwareAppointmentSyncLock} from './job-route-assignments';
import {executeScheduleOperation,readScheduleReceipt,readPendingScheduleReceipt,reconcileTruckSwitchMove} from './desktop-schedule-operations';
import {assertTruckNotSwitching,pendingTruckSwitch,readTruckSwitch,writeTruckSwitch,type TruckSwitch,type CompletedSwitchAssignment} from './crew-truck-switch-store';

export const truckSwitchSources={schedule:readDesktopSchedule,assignment:readJunkwareTruckAssignment,move:syncJunkwareTruckAssignment};
type Sources=typeof truckSwitchSources;
const creationLock='6d1d7259-8c4c-41d8-aaf7-d19a3d04c731';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** Date alone never resolves old work. Require an unambiguous terminal source
 * row observed after release; missing/unfinished/uncertain history fails closed. */
function historicalDispatchEvidence(states:CrewDispatch[],date:string,sources:Sources){
 const snapshots=new Map<string,ReturnType<Sources['schedule']>>();
 const evidence:Array<{recordId:string;version:string}>=[];
 for(const state of states)for(const assignment of [state.current,state.queued]){
  if(!assignment || assignment.date>=date)continue;
  if(!snapshots.has(assignment.date))snapshots.set(assignment.date,sources.schedule(assignment.date));
  const snapshot=snapshots.get(assignment.date)!;
  const matches=snapshot.appointments.filter(job=>job.appointmentId===assignment.appointmentId);
  const job=matches.length===1?matches[0]:null,observedAt=Date.parse(snapshot.observedAt || '');
  if(!job || snapshot.date!==assignment.date || job.recordId!==`${assignment.date}:appointment:${assignment.appointmentId}` || !Number.isFinite(observedAt) || observedAt<Date.parse(assignment.releasedAt) || observedAt>Date.now()+60_000
    || !['completed','cancelled'].includes(truckSwitchStatus(job.status) || '')
    || (job.junkwareSyncStatus && job.junkwareSyncStatus!=='verified')){
   throw new CrewPhoneError('An earlier-day dispatch assignment is unfinished or could not be verified complete or cancelled. Ask dispatch to review it before switching trucks.',409);
  }
  evidence.push({recordId:job.recordId,version:job.version});
 }
 return evidence;
}
/** Saved completion evidence only permits a preview. Fresh direct source reads
 * and operation locks are required before saving/finalizing a switch. */
function completedCurrentEvidence(state:CrewDispatch,date:string,snapshot:ReturnType<Sources['schedule']>):CompletedSwitchAssignment {
 const current=state.current;
 const matches=snapshot.appointments.filter(job=>job.appointmentId===current?.appointmentId);
 const job=matches.length===1?matches[0]:null;
 if(!current || current.date!==date || snapshot.date!==date || !crewScheduleFresh(snapshot.observedAt)
   || Date.parse(snapshot.observedAt || '')<Date.parse(current.releasedAt)
   || !job || job.recordId!==`${date}:appointment:${current.appointmentId}` || !sameTruck(job.truck,state.truck)
   || truckSwitchStatus(job.status)!=='completed' || (job.junkwareSyncStatus && job.junkwareSyncStatus!=='verified'))
  throw new CrewPhoneError('The released assignment is not verified complete on this truck. Ask dispatch to review it before switching.',409);
 return {appointmentId:current.appointmentId,recordId:job.recordId,assignmentId:current.assignmentId,releasedAt:current.releasedAt,version:job.version};
}
/** No closeout call or fabricated receipt: only retire this source-verified
 * completed pointer as part of the confirmed, audited truck transfer. */
async function withCompletedCurrent<T>(state:CrewDispatch,date:string,evidence:CompletedSwitchAssignment|undefined,sources:Sources,work:()=>Promise<T>):Promise<T>{
 if(!evidence)return work();
 return withScheduleOperationLock(`appointment-${evidence.appointmentId}`,()=>withJunkwareAppointmentSyncLock(evidence.appointmentId,async()=>{
  const verifySnapshot=()=>{
   const current=completedCurrentEvidence(state,date,sources.schedule(date));
   if(JSON.stringify(current)!==JSON.stringify(evidence))throw new CrewPhoneError('The completed assignment changed. Ask dispatch to review this switch.',409);
  };
  verifySnapshot();
  if(await readPendingScheduleReceipt(evidence.recordId))throw new CrewPhoneError('The completed job has an unverified saved result. Check it before switching.',409);
  const source=await sources.assignment(evidence.appointmentId);
  if(source.appointmentId!==evidence.appointmentId || source.date!==date || !sameTruck(source.truck,state.truck)
    || truckSwitchStatus(source.status)!=='completed' || !crewScheduleFresh(source.verifiedAt)
    || Date.parse(source.verifiedAt)<Date.parse(evidence.releasedAt))
   throw new CrewPhoneError('JunkWare does not verify the released job complete on this truck. Ask dispatch to review it.',409);
  verifySnapshot();
  return work();
 }));
}
function plan(phone:CrewPhone,to:string,sources:Sources){
 const day=requireCrewDay(phone);
 if(!JUNKWARE_DISPATCH_TRUCKS.includes(to) || to===day.truck)throw new CrewPhoneError('Choose a different replacement truck.');
 assertTruckNotSwitching(day.truck);assertTruckNotSwitching(to);
 if(listCrewPhones().some(p=>p.deviceId!==phone.deviceId && p.state==='active' && readCrewDay(p)?.truck===to))throw new CrewPhoneError('That truck is assigned to another phone today. Ask dispatch to release it first.',409);
 const snapshot=sources.schedule(day.date);
 if(snapshot.date!==day.date || !crewScheduleFresh(snapshot.observedAt))throw new CrewPhoneError('The schedule is not current. Refresh before switching trucks.',409);
 if(snapshot.appointments.some(j=>(sameTruck(j.truck,day.truck) || sameTruck(j.truck,to)) && !truckSwitchStatus(j.status)))throw new CrewPhoneError('A job has an unknown source status. Ask dispatch to review it before switching.',409);
 const jobs=snapshot.appointments.filter(j=>sameTruck(j.truck,day.truck) && truckSwitchStatus(j.status)==='confirmed').sort((a,b)=>a.appointmentId.localeCompare(b.appointmentId));
 if(new Set(jobs.map(j=>j.appointmentId)).size!==jobs.length || jobs.some(j=>j.junkwareSyncStatus && j.junkwareSyncStatus!=='verified'))throw new CrewPhoneError('An unfinished job needs dispatch verification before switching.',409);
 if(snapshot.appointments.some(j=>sameTruck(j.truck,to) && truckSwitchStatus(j.status)==='confirmed'))throw new CrewPhoneError('That truck already has unfinished jobs. Ask dispatch to release it first.',409);
 const fromState=readCrewDispatch(day.truck),toState=readCrewDispatch(to);
 // Historical dispatch pointers outlive daily phone sessions. Keep them in the
 // fingerprint/history. Older work must be verified terminal before retirement.
 if([toState.current,toState.queued].some(a=>a && a.date>=day.date))throw new CrewPhoneError('That truck has a current or upcoming dispatch assignment. Ask dispatch to release it first.',409);
 const completedCurrent=fromState.current?.date===day.date && !jobs.some(j=>j.appointmentId===fromState.current!.appointmentId)?completedCurrentEvidence(fromState,day.date,snapshot):undefined;
 if([fromState.current,fromState.queued].some(a=>a && (a.date>day.date || (a.date===day.date && !jobs.some(j=>j.appointmentId===a.appointmentId) && a.assignmentId!==completedCurrent?.assignmentId))))throw new CrewPhoneError('Refresh your current job and let dispatch resolve the released assignment before switching.',409);
 const historical=historicalDispatchEvidence([fromState,toState],day.date,sources);
 const fingerprint=createHash('sha256').update(JSON.stringify({day,fromState,toState,historical,completedCurrent,jobs:jobs.map(j=>[j.appointmentId,j.version]),to})).digest('hex');
 return {day,jobs,fromState,toState,historical,completedCurrent,fingerprint};
}
export function previewTruckSwitch(phone:CrewPhone,to:string,sources=truckSwitchSources){
 const p=plan(phone,to,sources);
 return {from:p.day.truck,to,count:p.jobs.length,fingerprint:p.fingerprint,inspection:crewInspectionState({...phone,truck:to},{...p.day,truck:to})};
}
export async function beginTruckSwitch(phone:CrewPhone,body:Record<string,unknown>,sources=truckSwitchSources){
 if(Object.keys(body).some(k=>!['action','requestId','to','fingerprint'].includes(k)) || body.action!=='confirm' || !uuid.test(String(body.requestId)) || typeof body.to!=='string' || typeof body.fingerprint!=='string')throw new CrewPhoneError('Review and confirm the replacement truck first.');
 return withScheduleOperationLock(`request-${creationLock}`,async()=>{
  const prior=readTruckSwitch(String(body.requestId));
  if(prior){if(prior.deviceId!==phone.deviceId || prior.to!==body.to || prior.fingerprint!==body.fingerprint)throw new CrewPhoneError('This switch reference was already used.',409);return prior;}
  if(pendingTruckSwitch(phone.deviceId))throw new CrewPhoneError('Check the saved truck switch before starting another.',409);
  const p=plan(phone,body.to as string,sources);
  if(p.fingerprint!==body.fingerprint)throw new CrewPhoneError('The truck or schedule changed. Review the switch again.',409);
  for(const job of [...p.jobs,...p.historical])if(await readPendingScheduleReceipt(job.recordId))throw new CrewPhoneError('A job has an unverified saved result. Check that result before switching trucks.',409);
  return withCompletedCurrent(p.fromState,p.day.date,p.completedCurrent,sources,async()=>{
  // Repeat after awaits so a concurrent release/setup cannot bypass the confirmation.
  if(plan(phone,body.to as string,sources).fingerprint!==p.fingerprint)throw new CrewPhoneError('Dispatch changed. Review the switch again.',409);
  const now=new Date().toISOString();
  return writeTruckSwitch({schema:1,requestId:String(body.requestId),deviceId:phone.deviceId,date:p.day.date,from:p.day.truck,to:body.to as string,day:p.day,sourceDispatch:p.fromState,...(p.completedCurrent?{completedCurrent:p.completedCurrent}:{}),targetDispatch:p.toState,fingerprint:p.fingerprint,createdAt:now,updatedAt:now,status:'moving',message:'Switch confirmed. Moving unfinished jobs.',jobs:p.jobs.map(j=>({appointmentId:j.appointmentId,version:j.version,requestId:randomUUID(),state:'pending'}))});
  });
 });
}
/** One bounded step per request. A saved/uncertain source write is only read back,
 * never submitted again. The browser may resume the same confirmed switch. */
export async function continueTruckSwitch(phone:CrewPhone,id:string,sources=truckSwitchSources){
 if(!uuid.test(id))throw new CrewPhoneError('Invalid switch reference.');
 return withScheduleOperationLock(`request-${id}`,async()=>{
  const initial=readTruckSwitch(id);
  if(!initial || initial.deviceId!==phone.deviceId)throw new CrewPhoneError('Truck switch not found.',404);
  let s:TruckSwitch=initial;
  if(s.status==='complete')return s;
  const save=(message:string,status:TruckSwitch['status']=s!.status)=>{s=writeTruckSwitch({...s!,message,status,updatedAt:new Date().toISOString()});return s;};
  try{
   const day=requireCrewDay(phone);
   if(day.date!==s.date || (day.version!==s.day.version && day.requestId!==id))throw new CrewPhoneError('Today’s crew changed. Dispatch must review this switch.',409);
   if([s.sourceDispatch.current,s.sourceDispatch.queued].some(a=>a && (a.date>s.date || (a.date===s.date && !s.jobs.some(j=>j.appointmentId===a.appointmentId) && !(a===s.sourceDispatch.current && a.assignmentId===s.completedCurrent?.assignmentId)))))throw new CrewPhoneError('The saved switch has an unresolved released assignment. Ask dispatch to review it.',409);
   return await withCompletedCurrent(s.sourceDispatch,s.date,s.completedCurrent,sources,async()=>{
   const row=s.jobs.find(j=>j.state!=='verified');
   if(row){
    const actor=`waypoint-switch:${id}`;
    const existing=await readScheduleReceipt(row.requestId);
    if(existing){
     const recovered=await reconcileTruckSwitchMove(row.requestId,actor,sources.assignment);
     if(recovered?.status!=='verified')throw new CrewPhoneError('A saved job move needs dispatch review. Its result will not be resubmitted.',409);
    }else{
     const operation={requestId:row.requestId,date:s.date,recordId:`${s.date}:appointment:${row.appointmentId}`,expectedVersion:row.version,action:'move' as const,values:{truck:s.to}};
     const result=await executeScheduleOperation(operation,actor,()=>sources.schedule(s!.date).appointments.find(j=>j.appointmentId===row.appointmentId),async(job:DesktopAppointment)=>withJunkwareAppointmentSyncLock(row.appointmentId,async()=>{
      const source=await sources.assignment(row.appointmentId);
      if(!sameTruck(source.truck,s!.from) || source.date!==s!.date || truckSwitchStatus(source.status)!=='confirmed' || !sameTruck(job.truck,s!.from))throw new CrewPhoneError('JunkWare changed this unfinished job. Dispatch must review the switch.',409);
      row.start=source.appointmentStartMinutes;row.end=source.appointmentEndMinutes;save('Moving unfinished jobs.','moving');
      const moved=await sources.move({appointmentId:row.appointmentId,truck:s!.to,expectedDate:s!.date});
      if(!sameTruck(moved.truck,s!.to) || moved.appointmentId!==row.appointmentId)throw new Error('Source move not verified.');
      // Read back, including unchanged appointment window, before claiming success.
      const check=await sources.assignment(row.appointmentId);
      if(!sameTruck(check.truck,s!.to) || check.date!==s!.date || truckSwitchStatus(check.status)!=='confirmed' || check.appointmentStartMinutes!==row.start || check.appointmentEndMinutes!==row.end)throw new Error('Source readback did not match the truck switch.');
      const assignment=saveJobRouteAssignment({date:s!.date,jobKey:`appt:${row.appointmentId}`,appointmentId:row.appointmentId,truck:s!.to,appointmentStartMinutes:row.start,appointmentEndMinutes:row.end,junkwareVerifiedAt:check.verifiedAt,junkwareSyncStatus:'verified'});
      if(!assignment)throw new Error('The saved assignment could not be confirmed.');
      return {status:200,body:{ok:true,assignment,junkwareSynced:true}};
     }));
     if(result.status!=='verified')throw new CrewPhoneError('A job move needs verification. Check the saved switch; do not start another.',409);
    }
    row.state='verified';
    return save('Job move verified. Continuing the confirmed switch.','moving');
   }
   // Both trucks are reserved until all source moves, dispatch records and daily
   // phone binding agree. Assignment IDs keep photos and closeout drafts intact.
   const snapshot=sources.schedule(s.date);
   if(!crewScheduleFresh(snapshot.observedAt) || snapshot.appointments.some(j=>sameTruck(j.truck,s!.from) && truckSwitchStatus(j.status)==='confirmed'))throw new CrewPhoneError('The schedule changed during this switch. Ask dispatch to review remaining jobs.',409);
   if(s.jobs.some(j=>!snapshot.appointments.some(a=>a.appointmentId===j.appointmentId && sameTruck(a.truck,s!.to) && truckSwitchStatus(a.status)==='confirmed')))throw new CrewPhoneError('The moved schedule needs verification. Check the saved switch again.',409);
   for(const job of historicalDispatchEvidence([s.sourceDispatch,s.targetDispatch],s.date,sources))if(await readPendingScheduleReceipt(job.recordId))throw new CrewPhoneError('An earlier-day job has an unverified saved result. Ask dispatch to review it before switching trucks.',409);
   historicalDispatchEvidence([s!.sourceDispatch,s!.targetDispatch],s!.date,sources);
   const latest=sources.schedule(s!.date);
   if(latest.date!==s!.date || !crewScheduleFresh(latest.observedAt) || latest.appointments.some(j=>(sameTruck(j.truck,s!.from) && truckSwitchStatus(j.status)==='confirmed') || ((sameTruck(j.truck,s!.from) || sameTruck(j.truck,s!.to)) && !truckSwitchStatus(j.status))) || s!.jobs.some(j=>latest.appointments.filter(a=>a.appointmentId===j.appointmentId && sameTruck(a.truck,s!.to) && truckSwitchStatus(a.status)==='confirmed').length!==1))throw new CrewPhoneError('The schedule changed during final verification. Ask dispatch to review this switch.',409);
   if(s.completedCurrent && JSON.stringify(completedCurrentEvidence(s.sourceDispatch,s.date,latest))!==JSON.stringify(s.completedCurrent))throw new CrewPhoneError('The completed assignment changed during final verification. Ask dispatch to review it.',409);
   transferCrewDispatch(s.sourceDispatch,s.targetDispatch,id,s.jobs.map(j=>j.appointmentId),s.date);
   saveCrewDay(phone,{date:s.date,truck:s.to,requestId:id,expectedVersion:s.day.version,responsible:s.day.responsible,driver:s.day.driver,navigators:s.day.navigators},new Date(),crewDayRoster(),id);
   return save('Truck switched. Your unfinished jobs and crew are on the replacement truck.','complete');
   });
  }catch(error){return save(error instanceof Error?error.message:'The switch needs verification. Contact dispatch.','attention');}
 });
}
