import {saveTimecardDelete,type TimecardDeleteReceipt} from './timecard-deletions';
import type {JunkwareShift} from './junkware-payroll-sync';
export type TimecardDeleteAdapter={read:()=>Promise<JunkwareShift|null>;prepare:(before:JunkwareShift)=>Promise<void>;submit:()=>Promise<void>;reload:()=>Promise<void>;assertCurrent:()=>void};
const same=(a:JunkwareShift|null,b:JunkwareShift)=>Boolean(a&&a.workDate===b.workDate&&a.clockIn===b.clockIn&&a.clockOut===b.clockOut&&a.hourlyRate===b.hourlyRate&&a.hours===b.hours&&a.labor===b.labor&&a.regularHours===b.regularHours&&a.overtimeHours===b.overtimeHours);
/** Single-entry day only. Adapter rejects multiple entries and overnight shifts.
 * Positional control IDs are resolved in the fresh native editor and never saved
 * as stable source identities. An interrupted submission is never replayed. */
export async function executeTimecardDelete(initial:TimecardDeleteReceipt,adapter:TimecardDeleteAdapter,checkOnly=false,write=saveTimecardDelete){
 let row=initial;const update=(patch:Partial<TimecardDeleteReceipt>)=>{const next={...row,...patch,updatedAt:new Date().toISOString()};write(next);row=next;};
 if(row.status==='verified'||row.status==='failed'||(checkOnly&&!row.submittedAt))return row;
 try{
  if(!row.submittedAt){
   if(Date.now()>=Date.parse(row.expiresAt))throw new Error('Confirmation expired. Reload the source entry.');
   adapter.assertCurrent();
   if(!same(await adapter.read(),row.before))throw new Error('This source entry changed. Reload before deleting.');
   await adapter.prepare(row.before);adapter.assertCurrent();
   if(Date.now()>=Date.parse(row.expiresAt))throw new Error('Confirmation expired. Nothing was deleted.');
   update({status:'submitted',submittedAt:new Date().toISOString(),message:'Deletion submitted. Verifying JunkWare.'});
   try{await adapter.submit();}catch{/* The native postback may have completed. Read only from this point. */}
  }
  await adapter.reload();
  if(await adapter.read()!==null)throw new Error('JunkWare still has an entry for this day. No deletion was retried.');
  update({status:'verified',verifiedAt:new Date().toISOString(),message:'Deleted in JunkWare. Saved payroll totals may still be awaiting synchronization.'});
 }catch(error){update({status:row.submittedAt?'uncertain':'failed',message:error instanceof Error?error.message:'Deletion could not be verified.'});}
 return row;
}
