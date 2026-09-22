import { sameTruck } from './junkware-trucks';
import {createHash,randomUUID} from 'node:crypto';
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
import {assertTruckNotSwitching,pendingTruckSwitch,readTruckSwitch,writeTruckSwitch,type TruckSwitch} from './crew-truck-switch-store';

export const truckSwitchSources={schedule:readDesktopSchedule,assignment:readJunkwareTruckAssignment,move:syncJunkwareTruckAssignment};
type Sources=typeof truckSwitchSources;
const creationLock='6d1d7259-8c4c-41d8-aaf7-d19a3d04c731';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function plan(phone:CrewPhone,to:string,sources:Sources){
 const day=requireCrewDay(phone);
 if(!JUNKWARE_DISPATCH_TRUCKS.includes(to) || to===day.truck)throw new CrewPhoneError('Choose a different replacement truck.');
 assertTruckNotSwitching(day.truck);assertTruckNotSwitching(to);
 if(listCrewPhones().some(p=>p.deviceId!==phone.deviceId && p.state==='active' && readCrewDay(p)?.truck===to))throw new CrewPhoneError('That truck is assigned to another phone today. Ask dispatch to release it first.',409);
 const snapshot=sources.schedule(day.date);
 if(!crewScheduleFresh(snapshot.observedAt))throw new CrewPhoneError('The schedule is not current. Refresh before switching trucks.',409);
 const jobs=snapshot.appointments.filter(j=>sameTruck(j.truck,day.truck) && /^confirmed$/i.test(j.status)).sort((a,b)=>a.appointmentId.localeCompare(b.appointmentId));
 if(new Set(jobs.map(j=>j.appointmentId)).size!==jobs.length || jobs.some(j=>j.junkwareSyncStatus && j.junkwareSyncStatus!=='verified'))throw new CrewPhoneError('An unfinished job needs dispatch verification before switching.',409);
 if(snapshot.appointments.some(j=>sameTruck(j.truck,to) && /^confirmed$/i.test(j.status)))throw new CrewPhoneError('That truck already has unfinished jobs. Ask dispatch to release it first.',409);
 const fromState=readCrewDispatch(day.truck),toState=readCrewDispatch(to);
 if(toState.current || toState.queued)throw new CrewPhoneError('That truck already has a phone assignment. Ask dispatch to release it first.',409);
 if([fromState.current,fromState.queued].some(a=>a && (a.date!==day.date || !jobs.some(j=>j.appointmentId===a.appointmentId))))throw new CrewPhoneError('Refresh your current job and let dispatch resolve the released assignment before switching.',409);
 const fingerprint=createHash('sha256').update(JSON.stringify({day,fromState,toState,jobs:jobs.map(j=>[j.appointmentId,j.version]),to})).digest('hex');
 return {day,jobs,fromState,toState,fingerprint};
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
  for(const job of p.jobs)if(await readPendingScheduleReceipt(job.recordId))throw new CrewPhoneError('A job has an unverified saved result. Check that result before switching trucks.',409);
  // Repeat after awaits so a concurrent release/setup cannot bypass the confirmation.
  if(plan(phone,body.to as string,sources).fingerprint!==p.fingerprint)throw new CrewPhoneError('Dispatch changed. Review the switch again.',409);
  const now=new Date().toISOString();
  return writeTruckSwitch({schema:1,requestId:String(body.requestId),deviceId:phone.deviceId,date:p.day.date,from:p.day.truck,to:body.to as string,day:p.day,sourceDispatch:p.fromState,targetDispatch:p.toState,fingerprint:p.fingerprint,createdAt:now,updatedAt:now,status:'moving',message:'Switch confirmed. Moving unfinished jobs.',jobs:p.jobs.map(j=>({appointmentId:j.appointmentId,version:j.version,requestId:randomUUID(),state:'pending'}))});
 });
}
/** One bounded step per request. A saved/uncertain source write is only read back,
 * never submitted again. The browser may resume the same confirmed switch. */
export async function continueTruckSwitch(phone:CrewPhone,id:string,sources=truckSwitchSources){
 if(!uuid.test(id))throw new CrewPhoneError('Invalid switch reference.');
 return withScheduleOperationLock(`request-${id}`,async()=>{
  let s=readTruckSwitch(id);
  if(!s || s.deviceId!==phone.deviceId)throw new CrewPhoneError('Truck switch not found.',404);
  if(s.status==='complete')return s;
  const save=(message:string,status:TruckSwitch['status']=s!.status)=>{s=writeTruckSwitch({...s!,message,status,updatedAt:new Date().toISOString()});return s;};
  try{
   const day=requireCrewDay(phone);
   if(day.date!==s.date || (day.version!==s.day.version && day.requestId!==id))throw new CrewPhoneError('Today’s crew changed. Dispatch must review this switch.',409);
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
      if(!sameTruck(source.truck,s!.from) || source.date!==s!.date || !/^confirmed$/i.test(source.status || '') || !sameTruck(job.truck,s!.from))throw new CrewPhoneError('JunkWare changed this unfinished job. Dispatch must review the switch.',409);
      row.start=source.appointmentStartMinutes;row.end=source.appointmentEndMinutes;save('Moving unfinished jobs.','moving');
      const moved=await sources.move({appointmentId:row.appointmentId,truck:s!.to,expectedDate:s!.date});
      if(!sameTruck(moved.truck,s!.to) || moved.appointmentId!==row.appointmentId)throw new Error('Source move not verified.');
      // Read back, including unchanged appointment window, before claiming success.
      const check=await sources.assignment(row.appointmentId);
      if(!sameTruck(check.truck,s!.to) || check.date!==s!.date || !/^confirmed$/i.test(check.status || '') || check.appointmentStartMinutes!==row.start || check.appointmentEndMinutes!==row.end)throw new Error('Source readback did not match the truck switch.');
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
   if(!crewScheduleFresh(snapshot.observedAt) || snapshot.appointments.some(j=>sameTruck(j.truck,s!.from) && /^confirmed$/i.test(j.status)))throw new CrewPhoneError('The schedule changed during this switch. Ask dispatch to review remaining jobs.',409);
   if(s.jobs.some(j=>!snapshot.appointments.some(a=>a.appointmentId===j.appointmentId && sameTruck(a.truck,s!.to) && /^confirmed$/i.test(a.status))))throw new CrewPhoneError('The moved schedule needs verification. Check the saved switch again.',409);
   transferCrewDispatch(s.sourceDispatch,s.targetDispatch,id,s.jobs.map(j=>j.appointmentId));
   saveCrewDay(phone,{date:s.date,truck:s.to,requestId:id,expectedVersion:s.day.version,responsible:s.day.responsible,driver:s.day.driver,navigators:s.day.navigators},new Date(),crewDayRoster(),id);
   return save('Truck switched. Your unfinished jobs and crew are on the replacement truck.','complete');
  }catch(error){return save(error instanceof Error?error.message:'The switch needs verification. Contact dispatch.','attention');}
 });
}
