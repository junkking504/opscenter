import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {normalizePayrollEmployeeKey} from '../lib/payroll-corrections';
/** Shared by source edits and deletions. A living writer is never displaced. */
export function acquirePayrollEmployeeLock(employeeName:string){
 const directory=path.join(process.env.OPSBOT_DATA_DIR||path.join(process.cwd(),'data'),'payroll_corrections','junkware-sync');fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const file=path.join(directory,`employee-${createHash('sha256').update(normalizePayrollEmployeeKey(employeeName)).digest('hex')}.lock`);
 try{fs.writeFileSync(file,String(process.pid),{flag:'wx',mode:0o600});}catch(error){
  if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
  const stat=fs.statSync(file),raw=fs.readFileSync(file,'utf8'),pid=Number(raw);
  if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Payroll writer lock needs inspection.');
  try{process.kill(pid,0);throw new Error('A payroll source operation is still running.');}catch(check){if((check as NodeJS.ErrnoException).code!=='ESRCH')throw check;}
  if(fs.statSync(file).ino!==stat.ino||fs.readFileSync(file,'utf8')!==raw)throw new Error('Payroll writer changed. Try checking the saved result again.');
  fs.unlinkSync(file);fs.writeFileSync(file,String(process.pid),{flag:'wx',mode:0o600});
 }
 const inode=fs.statSync(file).ino;
 return()=>{try{if(fs.statSync(file).ino===inode&&fs.readFileSync(file,'utf8')===String(process.pid))fs.unlinkSync(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}};
}
