import {crewCloseoutArrival,crewCloseoutTimes} from './crew-closeout-time';
import { crewCheckoutDryRun } from './crew-checkout-dry-run';
import { requireCrewDay,closeoutCrewDefaults } from './crew-phone-day';
import { CrewPhoneError } from './crew-phone';
import { requireCrewPhone } from './crew-phone-http';
import { readCrewDispatch } from './crew-dispatch-store';
import { crewScheduleFresh } from './crew-dispatch-service';
import { readDesktopSchedule } from './desktop-schedule';
import { withCrewJob } from './crew-job-scope';
import { junkwareJobCloseout, JunkwareCloseoutError } from './junkware-job-closeout';
import { closeoutSourceVersion } from './desktop-closeout-contract';
import { requireCloseoutPhotos } from './closeout-photo-policy';
import { validateCloseoutPayment, type CloseoutPayment, type PaymentOption } from './closeout-payment';
import { executeScheduleOperation, parseScheduleOperation, readPendingScheduleReceipt, readScheduleReceipt, reconcileCloseoutReceipt, type ScheduleReceipt } from './desktop-schedule-operations';
import { withJunkwareAppointmentSyncLock } from './job-route-assignments';
import { updateVerifiedCloseoutLoad } from './truck-load-closeouts';

const actorFor=(deviceId:string,assignmentId:string)=>`crew-phone:${deviceId}:${assignmentId}`;
export const crewCloseoutDependencies={
  scope:withCrewJob, schedule:readDesktopSchedule, read:junkwareJobCloseout,
  write:junkwareJobCloseout, updateLoad:updateVerifiedCloseoutLoad,
};
export function crewReceiptProjection(receipt:ScheduleReceipt) {
  const result=receipt.sourceResult;
  return {requestId:receipt.requestId,action:receipt.action,status:receipt.status,message:receipt.message,
    ...(result?.closeout ? {sourceResult:{appointmentId:result.appointmentId,closeout:result.closeout,truckLoadStatus:result.truckLoadStatus}} : {})};
}
export function validateCrewCloseout(values:Record<string,unknown>,truck:string,id:string,date:string) {
  const allowed=['appointmentId','targetStatus','truck','serviceDate','driverId','navigatorIds','loadQuantity','loadSize','loadPrice','bedloadQuantity','bedloadSize','bedloadPrice','otherChargesToAdd','discount','tip','jobCategoryId','howHeardId','actualStartHour','actualStartMinute','actualEndHour','actualEndMinute','addPayment','expectedSourceVersion','appointmentType','estimateOutcome'];
  if(Object.keys(values).some(key=>!allowed.includes(key)) || values.targetStatus!=='8' || values.truck!==truck || values.appointmentId!==id || values.serviceDate!==date
    || !['Job','Estimate'].includes(String(values.appointmentType)))throw new CrewPhoneError('Close only your current appointment using its assigned truck.',403);
  const payment=values.addPayment;
  if(payment!==null && payment!==undefined && (typeof payment!=='object' || Array.isArray(payment) || Object.keys(payment).some(key=>!['methodId','amount','reference'].includes(key))))throw new CrewPhoneError('Enter a collected payment with its method, amount and reference.');
}
export async function loadCrewCloseout(request:Request,assignmentId:string,deps=crewCloseoutDependencies) {
  return deps.scope(request,assignmentId,async({phone,current,job})=>{
    const result=await deps.read(current.appointmentId);
    if(result.appointmentId!==current.appointmentId || result.closeout?.truck!==phone.truck)throw new CrewPhoneError('The source appointment changed. Contact dispatch.',409);
    const pending=await readPendingScheduleReceipt(job.recordId),actor=actorFor(phone.deviceId,current.assignmentId);
    const day=result.closeout.status?.value==='1' && !pending?requireCrewDay(phone,current.date):null;
    return {arrival:crewCloseoutArrival(job,phone.truck,current.date),dryRun:crewCheckoutDryRun(current,phone.truck),crewVersion:day?.version || 0,crewDefaults:day?closeoutCrewDefaults(day,result.closeout):undefined,closeout:result.closeout,sourceVersion:closeoutSourceVersion(result.closeout),jobVersion:job.version,
      canWrite:result.closeout.status?.value==='1' && (!pending || pending.actor===actor),pendingReceipt:pending?.actor===actor?crewReceiptProjection(pending):null,
      message:pending && pending.actor!==actor?'The office must verify an earlier change before this appointment can be closed.':result.closeout.status?.value==='8'?'This appointment is already completed in JunkWare. Refresh your assignment.':undefined};
  });
}
export async function submitCrewCloseout(request:Request,body:Record<string,unknown>,deps=crewCloseoutDependencies) {
  const phone=requireCrewPhone(request),assignmentId=String(body.assignmentId || '');
  const current=readCrewDispatch(phone.truck).current;
  if(!current || current.assignmentId!==assignmentId)throw new CrewPhoneError('Dispatch changed. Refresh your assignment.',409);
  if(crewCheckoutDryRun(current,phone.truck))throw new CrewPhoneError('This is a dry run. Live closeout writes are disabled.',409);
  if(Object.keys(body).some(key=>!['assignmentId','requestId','expectedVersion','crewVersion','values'].includes(key)))throw new CrewPhoneError('Use the current closeout screen.');
  const operation=parseScheduleOperation({requestId:body.requestId,date:current.date,recordId:`${current.date}:appointment:${current.appointmentId}`,expectedVersion:body.expectedVersion,action:'closeout',values:body.values});
  validateCrewCloseout(operation.values,phone.truck,current.appointmentId,current.date);
  const actor=actorFor(phone.deviceId,assignmentId);
  // Order matches manager saves: durable operation locks, then owning source lock.
  return executeScheduleOperation(operation,actor,()=>{
    requireCrewPhone(request);
    if(readCrewDispatch(phone.truck).current?.assignmentId!==assignmentId)throw new CrewPhoneError('Dispatch changed. Refresh your assignment.',409);
    const snapshot=deps.schedule(current.date);
    if(!crewScheduleFresh(snapshot.observedAt))throw new CrewPhoneError('The appointment source is unavailable. Contact dispatch.',409);
    const matches=snapshot.appointments.filter(job=>job.appointmentId===current.appointmentId && job.truck===phone.truck);
    return matches.length===1?matches[0]:undefined;
  },async(_job,receipt)=>{
    let writeStarted=false;
    try {
      return await deps.scope(request,assignmentId,async({phone,current,job})=>{
        const before=await deps.read(current.appointmentId);
        if(before.appointmentId!==current.appointmentId || before.closeout?.truck!==phone.truck || before.closeout?.status?.value!=='1'
          || closeoutSourceVersion(before.closeout)!==operation.values.expectedSourceVersion)throw new CrewPhoneError('This closeout changed. Reload and review the saved appointment.',409);
        requireCloseoutPhotos(before.closeout,'8',current.appointmentId);
        if(operation.values.addPayment){
          const payment=operation.values.addPayment as CloseoutPayment,methods=before.closeout.paymentMethods as PaymentOption[];
          const error=validateCloseoutPayment(payment,methods);
          if(error)throw new CrewPhoneError(error);
          if(/billed/i.test(methods.find(method=>method.value===payment.methodId)?.label || ''))throw new CrewPhoneError('Record only money already collected. The office handles billing.');
        }
        const day=requireCrewDay(phone,current.date),defaults=closeoutCrewDefaults(day,before.closeout);
        const navigatorIds=operation.values.navigatorIds;
        const available=before.closeout.navigatorOptions as Array<{value:string}>;
        if(body.crewVersion!==day.version)throw new CrewPhoneError('Today’s crew changed. Reload the closeout before saving.',409);
        if(operation.values.driverId!==defaults.driver.value || !Array.isArray(navigatorIds) || navigatorIds.length>10
          || new Set([operation.values.driverId,...navigatorIds]).size!==navigatorIds.length+1
          || defaults.navigators.some(row=>!navigatorIds.includes(row.value))
          || navigatorIds.some(id=>typeof id!=='string' || !available.some(row=>row.value===id)))throw new CrewPhoneError('Use today’s assigned driver and navigator. You may add additional crew for this job.',409);
        // Time is server-owned. The durable receipt fixes End across retries;
        // the scoped GPS visits fix Start independently of client-entered values.
        const timing=crewCloseoutTimes(job,phone.truck,current.date,receipt.createdAt!,before.closeout as unknown as Parameters<typeof crewCloseoutTimes>[4]);
        // Recheck revocation immediately before the source write, after the read.
        requireCrewPhone(request);
        writeStarted=true;
        const result=await deps.write(current.appointmentId,{...operation.values,...timing});
        let truckLoadStatus;
        try {truckLoadStatus=deps.updateLoad(current.date,current.appointmentId,result.closeout,String(result.verifiedAt || ''),actor);}
        catch {truckLoadStatus={updated:false,reason:'Closeout saved; truck load reconciliation is pending.'};}
        return {status:200,body:{...result,truckLoadStatus,jobTiming:{arrival:crewCloseoutArrival(job,phone.truck,current.date),submittedAt:receipt.createdAt,...timing},crewContext:{deviceId:phone.deviceId,assignmentId,truck:phone.truck,sourceDriver:job.driver,sourceNavigator:job.navigator,dailyCrew:day}}};
      });
    }catch(error){
      const preflight=!writeStarted || error instanceof JunkwareCloseoutError && error.stage==='preflight';
      return {status:preflight?409:502,body:{ok:false,error:preflight?(error instanceof Error?error.message:'The closeout could not be loaded.'):'The saved closeout could not be verified. Check Saved Result; do not record another payment.',stage:preflight?'preflight':'uncertain'}};
    }
  });
}
export async function checkCrewCloseout(request:Request,assignmentId:string,requestId:string,reconcile:boolean,deps=crewCloseoutDependencies) {
  const phone=requireCrewPhone(request),actor=actorFor(phone.deviceId,assignmentId);
  const initial=await readScheduleReceipt(requestId);
  if(!initial || initial.actor!==actor || initial.action!=='closeout')throw new CrewPhoneError('Closeout receipt not found. Contact the office before another payment.',404);
  const receipt=reconcile?await reconcileCloseoutReceipt(requestId,actor,id=>withJunkwareAppointmentSyncLock(id,async()=>{requireCrewPhone(request);return(await deps.read(id)).closeout;})):initial;
  requireCrewPhone(request);
  return receipt!;
}

export async function simulateCrewCloseout(request:Request,body:Record<string,unknown>) {
  const phone=requireCrewPhone(request),current=readCrewDispatch(phone.truck).current;
  if(!current || current.assignmentId!==body.assignmentId)throw new CrewPhoneError('Dispatch changed. Refresh your assignment.',409);
  const dryRun=crewCheckoutDryRun(current,phone.truck);
  if(!dryRun){if(body.dryRun===true)throw new CrewPhoneError('Dry-run protection changed. Reload before continuing.',409);return null;}
  const operation=parseScheduleOperation({requestId:body.requestId,date:current.date,recordId:`${current.date}:appointment:${current.appointmentId}`,expectedVersion:body.expectedVersion,action:'closeout',values:body.values});
  validateCrewCloseout(operation.values,phone.truck,current.appointmentId,current.date);
  return {requestId:operation.requestId,action:'closeout',status:'reconciled',dryRun:true,message:'Dry run complete. Nothing was uploaded or saved to JunkWare. No customer receipt was sent.'};
}
