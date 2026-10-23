import {readScheduleReceipt,reconcileCustomerCorrection,type ScheduleReceipt} from './desktop-schedule-operations';
import {junkwareCustomerCorrection} from './junkware-customer-correction';
import {withJunkwareAppointmentSyncLock} from './job-route-assignments';
export function canRecoverCustomerCorrection(role:string,receipt:ScheduleReceipt|null):boolean {
  return ['admin','manager'].includes(role) && receipt?.action==='customer_correction';
}
/** Office recovery is read-only and survives a revoked phone, day rollover,
 * completion or reassignment. It never delegates source mutation authority. */
export async function recoverCustomerCorrectionForOffice(role:string,requestId:string,reconcile:boolean,read=junkwareCustomerCorrection){
  const receipt=await readScheduleReceipt(requestId);
  if(!canRecoverCustomerCorrection(role,receipt) || !receipt)throw new Error('Manager customer correction recovery access is required.');
  return (reconcile?await reconcileCustomerCorrection(requestId,receipt.actor,id=>withJunkwareAppointmentSyncLock(id,()=>read(id))):receipt)||receipt;
}
export function customerRecoveryProjection(receipt:ScheduleReceipt){
  return {requestId:receipt.requestId,action:receipt.action,status:receipt.status,message:receipt.message,date:receipt.date,recordId:receipt.recordId,updatedAt:receipt.updatedAt};
}
