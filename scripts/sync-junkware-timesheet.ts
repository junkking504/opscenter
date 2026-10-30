import {acquirePayrollEmployeeLock} from './payroll-employee-lock';
import {payrollCorrectionForEmployee} from '../lib/payroll-corrections';
import {readPayrollSync,writePayrollSync} from '../lib/junkware-payroll-sync';
import {executePayrollSourceSync} from '../lib/junkware-payroll-execution';
import {openTimesheets,openEmployee,readShift,prepareShift,linkPostback} from './junkware-timesheets';
const arg=(name:string)=>process.argv[process.argv.indexOf(`--${name}`)+1]||'';
async function main() {
  const inspect=process.argv.includes('--inspect');
  const initial=inspect?null:readPayrollSync(arg('sync-id'));
  const correction=inspect?payrollCorrectionForEmployee(arg('date'),arg('employee')):initial?.correction;
  if(!correction)throw new Error('Saved correction not found.');
  let row=initial;const release=initial?acquirePayrollEmployeeLock(correction.employeeName):undefined;
  let browser:Awaited<ReturnType<typeof openTimesheets>>['browser']|undefined;
  try {
    const session=await openTimesheets();browser=session.browser;const page=session.page;
    if(inspect){const identity=await openEmployee(page,correction);const {shift}=await readShift(page,correction.workDate);console.log(JSON.stringify({employee:correction.employeeName,date:correction.workDate,...identity,source:shift,requested:{clockIn:correction.clockIn,clockOut:correction.clockOut,hourlyRate:correction.hourlyRate}}));return;}
    let identity:{employeeId:string;marketId:string};let rowId:string|null=null,save='';
    row=await executePayrollSourceSync(row!,{
      resolve:async()=>{identity=await openEmployee(page,correction,row?.employeeId&&row.marketId?{employeeId:row.employeeId,marketId:row.marketId}:undefined);return identity;},
      read:async()=>{const result=await readShift(page,correction.workDate);rowId=result.rowId;return result.shift;},
      prepare:async before=>{save=await prepareShift(page,correction,rowId,before);},
      submit:async()=>{await linkPostback(page,save);},
      reload:async()=>{await openEmployee(page,correction,identity);},
    },process.argv.includes('--verify-only'));
    console.log(JSON.stringify({id:row.id,status:row.status,message:row.message,verifiedAt:row.verifiedAt,employee:correction.employeeName,date:correction.workDate,after:row.after}));
  }catch(error){if(row){row=readPayrollSync(row.id)||row;writePayrollSync({...row,status:row.submittedAt?'uncertain':'failed',updatedAt:new Date().toISOString(),message:'JunkWare timesheets could not be opened. Check the saved result.'});}throw error;}finally{try{await browser?.close();}finally{release?.();}}
}
main().catch(error=>{console.error(error instanceof Error?error.message.split('\n')[0]:'JunkWare timesheet worker could not complete. Check the saved result.');process.exitCode=1;});
