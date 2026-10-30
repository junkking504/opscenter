import {acquirePayrollEmployeeLock} from './payroll-employee-lock';
import {randomUUID} from 'node:crypto';
import {openTimesheets,openEmployee,readShift,prepareTimecardDelete,linkPostback} from './junkware-timesheets';
import {payrollCorrectionForEmployee} from '../lib/payroll-corrections';
import {assertPayrollSyncEditable} from '../lib/junkware-payroll-sync';
import {readTimecardDelete,saveTimecardDelete,correctionVersion,assertNoTimecardDeletion,type TimecardDeleteReceipt} from '../lib/timecard-deletions';
import {executeTimecardDelete} from '../lib/timecard-delete-execution';
const arg=(name:string)=>process.argv[process.argv.indexOf(`--${name}`)+1]||'';
async function main(){
 const preview=process.argv.includes('--preview'),initial=preview?null:readTimecardDelete(arg('id'));
 if(!preview&&!initial)throw new Error('Deletion receipt not found.');
 const employeeName=initial?.employeeName||arg('employee'),workDate=initial?.workDate||arg('date');
 if(!employeeName||employeeName.length>200||!/^\d{4}-\d{2}-\d{2}$/.test(workDate))throw new Error('Valid employee and date required.');
 const release=acquirePayrollEmployeeLock(employeeName);
 let browser:Awaited<ReturnType<typeof openTimesheets>>['browser']|undefined;
 try{
  const session=await openTimesheets();browser=session.browser;const page=session.page;
  const person={employeeName,workDate};
  const identity=await openEmployee(page,person,initial?{employeeId:initial.employeeId,marketId:initial.marketId}:undefined,true);
  const read=async()=>{if(await page.locator('#time-entries').count()!==1||await page.locator('[id$=_UserIDHF]').inputValue()!==identity.employeeId||await page.locator('#ctl00_FranchiseDD').inputValue()!==identity.marketId)throw new Error('The employee timesheet could not be verified.');return readShift(page,workDate);};
  let rowId:string|null=null,button='';
  if(preview){
   assertPayrollSyncEditable(workDate,employeeName);assertNoTimecardDeletion(workDate,employeeName);
   const {shift,rowId:sourceRow}=await read();if(!shift||!sourceRow)throw new Error('No source time entry is present for this day.');
   // Opening the exact editor verifies explicit dates and fields without saving.
   await prepareTimecardDelete(page,sourceRow,shift,identity);
   const now=new Date().toISOString();const row:TimecardDeleteReceipt={id:randomUUID(),actor:arg('actor'),employeeName,workDate,...identity,before:shift,correctionVersion:correctionVersion(payrollCorrectionForEmployee(workDate,employeeName)),status:'preview',createdAt:now,updatedAt:now,expiresAt:new Date(Date.now()+300000).toISOString(),message:'Review this source entry. Deletion may be permanent.'};
   saveTimecardDelete(row);console.log(JSON.stringify({id:row.id}));return;
  }
  const result=await executeTimecardDelete(readTimecardDelete(initial!.id)!,{
   read:async()=>{const result=await read();rowId=result.rowId;return result.shift;},
   prepare:async before=>{if(!rowId)throw new Error('Source entry disappeared.');button=await prepareTimecardDelete(page,rowId,before,identity);},
   submit:async()=>linkPostback(page,button),reload:async()=>{await openEmployee(page,person,identity,true);},
   assertCurrent:()=>{assertPayrollSyncEditable(workDate,employeeName);assertNoTimecardDeletion(workDate,employeeName,initial!.id);if(correctionVersion(payrollCorrectionForEmployee(workDate,employeeName))!==initial!.correctionVersion)throw new Error('The payroll correction changed. Reload before deleting.');},
  },process.argv.includes('--check'));
  console.log(JSON.stringify({id:result.id}));
 }catch(error){if(initial){const current=readTimecardDelete(initial.id);if(current&&!['verified','failed'].includes(current.status))saveTimecardDelete({...current,status:current.submittedAt?'uncertain':'failed',updatedAt:new Date().toISOString(),message:current.submittedAt?'Source result unconfirmed. Check saved result; no deletion was retried.':'Source verification failed before deletion. Reload the entry before trying again.'});}throw error;}finally{try{await browser?.close();}finally{release();}}
}
main().catch(()=>{console.error('JunkWare entry could not be verified. No automatic retry was made.');process.exitCode=1;});
