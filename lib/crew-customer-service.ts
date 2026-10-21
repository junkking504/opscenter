import {requireCrewReady} from './crew-phone-http';
import {requireCrewDay} from './crew-phone-day';
import {CrewPhoneError} from './crew-phone';
import {readCrewJobScope,withCrewJob} from './crew-job-scope';
import {sameTruck} from './junkware-trucks';
import {readDesktopSchedule} from './desktop-schedule';
import {crewCheckoutDryRun} from './crew-checkout-dry-run';
import {junkwareCustomerCorrection,CustomerCorrectionError} from './junkware-customer-correction';
import {normalizeCustomerFields,verifyCustomerCorrection,type CustomerSource} from './crew-customer-contract';
import {queueScheduleOperation,finishQueuedScheduleOperation,readPendingScheduleReceipt,readScheduleReceipt,setPendingCustomerCorrection,reconcileCustomerCorrection,type ScheduleReceipt,type ScheduleOperation} from './desktop-schedule-operations';

export const customerDependencies={local:readCrewJobScope,scope:withCrewJob,source:junkwareCustomerCorrection,schedule:readDesktopSchedule};
const actorFor=(device:string,assignment:string)=>`crew-customer:${device}:${assignment}`;
export function customerReceipt(receipt:ScheduleReceipt){const saved=receipt.sourceResult?.customer as CustomerSource|undefined;return {requestId:receipt.requestId,status:receipt.status,message:receipt.status==='verified'?'Customer information saved and verified in JunkWare.':receipt.message,...(receipt.status==='verified'&&saved?{customer:{fields:saved.fields,city:saved.city,state:saved.state}}:{})};}
function assertSource(source:CustomerSource,appointmentId:string,date:string,truck:string){
  if(source.appointmentId!==appointmentId || source.date!==date || !sameTruck(source.truck,truck) || source.status!=='1')throw new CrewPhoneError('Only open appointments assigned to your truck can be corrected here.',409);
}
export async function loadCrewCustomer(request:Request,assignmentId:string,deps=customerDependencies){
  return deps.scope(request,assignmentId,async({phone,current,job})=>{
    if(!sameTruck(job.truck,phone.truck) || !/^confirmed$/i.test(job.status))throw new CrewPhoneError('Only your truck’s open appointments can be corrected here.',409);
    const pending=await readPendingScheduleReceipt(job.recordId),actor=actorFor(phone.deviceId,assignmentId);
    if(pending)return {canWrite:false,pendingReceipt:pending.actor===actor?customerReceipt(pending):null,message:'An earlier appointment change needs verification before customer information can be edited.'};
    const source=await deps.source(current.appointmentId);assertSource(source,current.appointmentId,current.date,phone.truck);
    const day=requireCrewDay(requireCrewReady(request));
    return {canWrite:!crewCheckoutDryRun(current,phone.truck),fields:source.fields,city:source.city,state:source.state,sourceVersion:source.sourceVersion,jobVersion:job.version,crewVersion:day.version,message:crewCheckoutDryRun(current,phone.truck)?'Customer corrections are unavailable during a dry run.':undefined};
  });
}
export async function queueCrewCustomer(request:Request,body:Record<string,unknown>,deps=customerDependencies){
  if(Object.keys(body).some(key=>!['assignmentId','requestId','expectedVersion','expectedSourceVersion','crewVersion','fields'].includes(key)))throw new CrewPhoneError('Use the customer correction form.');
  const assignmentId=String(body.assignmentId||''),requestId=String(body.requestId||'');
  const initial=deps.local(request,assignmentId),{phone,current,day}=initial;
  requireCrewReady(request);
  if(!sameTruck(initial.job.truck,phone.truck) || !/^confirmed$/i.test(initial.job.status) || crewCheckoutDryRun(current,phone.truck))throw new CrewPhoneError('Only your truck’s open appointments can be corrected here.',403);
  if(day.version!==body.crewVersion)throw new CrewPhoneError('Today’s crew changed. Reload customer information.',409);
  if(!/^[a-f0-9]{64}$/.test(String(body.expectedVersion)) || !/^[a-f0-9]{64}$/.test(String(body.expectedSourceVersion)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))throw new CrewPhoneError('Reload customer information before saving.');
  let fields;try{fields=normalizeCustomerFields(body.fields);}catch(error){throw new CrewPhoneError((error as Error).message);}
  const actor=actorFor(phone.deviceId,assignmentId);
  // This action is intentionally not accepted by the general office parser.
  const operation:ScheduleOperation={requestId,date:current.date,recordId:`${current.date}:appointment:${current.appointmentId}`,expectedVersion:String(body.expectedVersion),action:'customer_correction',values:{fields,expectedSourceVersion:body.expectedSourceVersion,crewVersion:day.version}};
  const queued=await queueScheduleOperation(operation,actor,()=>deps.schedule(current.date).appointments.find(job=>job.recordId===operation.recordId));
  return {receipt:customerReceipt(queued.receipt),run:queued.created?async()=>finishQueuedScheduleOperation(queued,async(_job,receipt)=>{
    let writeStarted=false;
    try{return await deps.scope(request,assignmentId,async scope=>{
      const latestDay=requireCrewDay(requireCrewReady(request));
      if(latestDay.version!==day.version || !sameTruck(scope.job.truck,phone.truck))throw new CrewPhoneError('Crew or truck assignment changed. Reload customer information.',409);
      const source=await deps.source(current.appointmentId);assertSource(source,current.appointmentId,current.date,phone.truck);
      if(source.sourceVersion!==body.expectedSourceVersion)throw new CrewPhoneError('Customer or appointment details changed. Reload and review them before saving.',409);
      await setPendingCustomerCorrection(receipt,source,fields,{deviceId:phone.deviceId,truck:day.truck,date:day.date,version:day.version,responsible:day.responsible,driver:day.driver,navigators:day.navigators});
      const active=requireCrewReady(request);
      if(active.deviceId!==phone.deviceId || !sameTruck(active.truck,phone.truck) || requireCrewDay(active).version!==day.version)throw new CrewPhoneError('Phone or crew access changed. Reload the appointment.',409);
      writeStarted=true;
      const saved=await deps.source(current.appointmentId,{fields,expectedSourceVersion:source.sourceVersion,date:current.date,truck:source.truck});
      verifyCustomerCorrection(saved,fields,source.protectedVersion);
      return {status:200,body:{ok:true,customer:saved}};
    });}catch(error){
      if(!writeStarted && error instanceof CrewPhoneError || error instanceof CustomerCorrectionError && error.stage==='preflight')return {status:409,body:{error:error.message}};
      return {status:202,body:{error:'Customer correction needs verification. Check the saved result before another change.'}};
    }
  }):null};
}
export async function checkCrewCustomer(request:Request,assignmentId:string,requestId:string,reconcile=false,deps=customerDependencies){
  const {phone,current}=deps.local(request,assignmentId);requireCrewReady(request);
  const actor=actorFor(phone.deviceId,assignmentId),receipt=await readScheduleReceipt(requestId);
  if(!receipt || receipt.actor!==actor || receipt.action!=='customer_correction' || receipt.recordId!==`${current.date}:appointment:${current.appointmentId}`)throw new CrewPhoneError('Customer correction receipt not found.',404);
  const checked=reconcile?await reconcileCustomerCorrection(requestId,actor,id=>deps.scope(request,assignmentId,async scope=>{
    if(scope.current.appointmentId!==id || !sameTruck(scope.job.truck,phone.truck))throw new CrewPhoneError('This appointment changed.',409);
    const source=await deps.source(id);assertSource(source,id,scope.current.date,phone.truck);requireCrewReady(request);return source;
  })):receipt;
  requireCrewReady(request);
  return customerReceipt(checked||receipt);
}
