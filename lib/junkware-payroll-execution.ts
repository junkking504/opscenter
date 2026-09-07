import {payrollSyncIsCurrent,sameShift,writePayrollSync,type PayrollSync,type JunkwareShift} from './junkware-payroll-sync';
export type TimesheetAdapter={
  resolve:()=>Promise<{employeeId:string;marketId:string}>;
  read:()=>Promise<JunkwareShift|null>;
  prepare:(before:JunkwareShift|null)=>Promise<void>;
  submit:()=>Promise<void>;
  reload:()=>Promise<void>;
};
/** Receipts survive browser and process failures. A submitted write is never
 * repeated as a method of finding out whether it succeeded. */
export async function executePayrollSourceSync(initial:PayrollSync,adapter:TimesheetAdapter,verifyOnly=false):Promise<PayrollSync> {
  let row=initial;
  const update=(patch:Partial<PayrollSync>)=>{row={...row,...patch,updatedAt:new Date().toISOString()};writePayrollSync(row);};
  try {
    if(!payrollSyncIsCurrent(row))throw new Error('The saved correction changed. Refresh before synchronizing.');
    if(row.status==='verified'&&!verifyOnly)return row;
    const readOnly=verifyOnly||Boolean(row.submittedAt);
    update({status:'pending',phase:row.submittedAt?'submitted':'reading',message:readOnly?'Checking the saved JunkWare result.':'Checking the JunkWare employee and shift.'});
    update(await adapter.resolve());
    const before=await adapter.read();
    if(!sameShift(before,row.correction)) {
      if(readOnly)throw new Error('JunkWare does not match the saved correction. No change was resubmitted.');
      await adapter.prepare(before);
      if(!payrollSyncIsCurrent(row))throw new Error('The correction changed before submission. Nothing was sent.');
      update({before,phase:'submitted',submittedAt:new Date().toISOString(),message:'JunkWare save submitted; verifying the source record.'});
      try{await adapter.submit();}catch{/* Submission may have succeeded despite interrupted navigation. */}
    }
    await adapter.reload();const after=await adapter.read();
    if(!sameShift(after,row.correction))throw new Error('JunkWare did not verify all corrected times and the shift rate. Review the source before another change.');
    update({status:'verified',phase:'complete',after:after!,verifiedAt:new Date().toISOString(),message:'Clock-in, clock-out, and shift hourly rate verified in JunkWare.'});
  }catch(error){update({status:row.submittedAt?'uncertain':'failed',message:`Saved in OpsCenter. ${error instanceof Error?error.message:'JunkWare verification failed.'}`});}
  return row;
}
