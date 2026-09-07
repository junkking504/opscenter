import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {normalizePayrollEmployeeKey, payrollCorrectionForEmployee, type PayrollCorrection} from './payroll-corrections';

export type JunkwareShift = {workDate:string; clockIn:string; clockOut:string; hourlyRate:number; hours:number|null; regularHours:number|null; overtimeHours:number|null; labor:number|null};
export type PayrollSync = {
  id:string; correction:PayrollCorrection; status:'pending'|'verified'|'failed'|'uncertain';
  phase:'queued'|'reading'|'submitted'|'complete'; message:string; updatedAt:string; verifiedAt?:string;
  employeeId?:string; marketId?:string; before?:JunkwareShift|null; after?:JunkwareShift; submittedAt?:string;
};
const root=()=>path.join(process.env.OPSBOT_DATA_DIR||path.join(process.cwd(),'data'),'payroll_corrections','junkware-sync');
export const payrollSyncId=(correction:PayrollCorrection)=>createHash('sha256').update(JSON.stringify(correction)).digest('hex');
const syncPath=(id:string)=>{if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid payroll synchronization ID.');return path.join(root(),`${id}.json`);};
export function readPayrollSync(id:string):PayrollSync|null {
  try{const row:PayrollSync=JSON.parse(fs.readFileSync(syncPath(id),'utf8'));return row.status==='pending'&&Date.now()-Date.parse(row.updatedAt)>180_000?{...row,status:'uncertain',message:'JunkWare verification was interrupted. Check saved result before another change.'}:row;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
export function writePayrollSync(row:PayrollSync) {
  fs.mkdirSync(root(),{recursive:true,mode:0o700});const file=syncPath(row.id),temp=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(row),{mode:0o600});fs.renameSync(temp,file);
}
export function payrollSyncForCorrection(correction:PayrollCorrection|null) {return correction?readPayrollSync(payrollSyncId(correction)):null;}
export function assertPayrollSyncEditable(date:string,name:string) {
  if(!fs.existsSync(root()))return;
  for(const file of fs.readdirSync(root()).filter(file=>/^[a-f0-9]{64}\.json$/.test(file))) {
    const row=readPayrollSync(file.slice(0,-5));
    if(row&&row.correction.workDate===date&&row.correction.normalizedEmployeeName===normalizePayrollEmployeeKey(name)&&['pending','uncertain'].includes(row.status))
      throw new Error('This shift has an unconfirmed JunkWare change. Check its saved result before another correction.');
  }
}
export function stagePayrollSync(correction:PayrollCorrection,requestId?:string):PayrollSync {
  const id=payrollSyncId(correction);
  let row=readPayrollSync(id);
  if(!row){row={id,correction,status:'pending',phase:'queued',message:'Saved in OpsCenter. JunkWare verification pending.',updatedAt:new Date().toISOString()};writePayrollSync(row);}
  if(requestId){if(!/^[0-9a-f-]{36}$/i.test(requestId))throw new Error('Invalid correction request ID.');fs.mkdirSync(path.join(root(),'requests'),{recursive:true,mode:0o700});fs.writeFileSync(path.join(root(),'requests',`${requestId}.json`),JSON.stringify({id}),{mode:0o600});}
  return row;
}
export function payrollSyncForRequest(requestId:string):PayrollSync|null {
  if(!/^[0-9a-f-]{36}$/i.test(requestId))return null;
  try{const {id}=JSON.parse(fs.readFileSync(path.join(root(),'requests',`${requestId}.json`),'utf8'));return readPayrollSync(id);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
export function payrollSyncMessage(row:PayrollSync|null):string {
  if(!row)return 'Not synced to JunkWare';
  if(row.status==='verified')return 'Times and shift rate verified in JunkWare';
  return row.message;
}
/** A timeout may follow a successful write. The worker journals submission first;
 * subsequent checks only read the source when a submission has already started. */
export async function runPayrollSync(id:string,verifyOnly=false):Promise<PayrollSync> {
  const row=readPayrollSync(id);if(!row)throw new Error('Correction synchronization was not staged.');
  if(row.status==='verified'&&!verifyOnly)return row;
  try {
    await promisify(execFile)(process.execPath,['--import','tsx',path.join(process.cwd(),'scripts','sync-junkware-timesheet.ts'),'--sync-id',id,...(verifyOnly?['--verify-only']:[])],{cwd:process.cwd(),env:{...process.env},timeout:150_000,maxBuffer:256_000});
  } catch {
    const current=readPayrollSync(id)!;
    if(current.status==='pending')writePayrollSync({...current,status:'uncertain',message:'Saved in OpsCenter; JunkWare result unconfirmed. Check saved result before another change.',updatedAt:new Date().toISOString()});
  }
  return readPayrollSync(id)!;
}
export function payrollSyncIsCurrent(row:PayrollSync) {
  const current=payrollCorrectionForEmployee(row.correction.workDate,row.correction.employeeName);
  return current!==null&&payrollSyncId(current)===row.id;
}
export function sameShift(actual:JunkwareShift|undefined|null,correction:Pick<PayrollCorrection,'workDate'|'clockIn'|'clockOut'|'hourlyRate'>) {
  return Boolean(actual&&actual.workDate===correction.workDate&&actual.clockIn===correction.clockIn&&actual.clockOut===correction.clockOut&&Math.abs(actual.hourlyRate-correction.hourlyRate)<0.005);
}
