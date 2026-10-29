import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {normalizePayrollEmployeeKey,type PayrollCorrection} from './payroll-corrections';
import type {JunkwareShift} from './junkware-payroll-sync';
export type TimecardDeleteReceipt={
 id:string;actor:string;employeeName:string;workDate:string;createdAt:string;updatedAt:string;expiresAt:string;
 status:'preview'|'submitted'|'verified'|'failed'|'uncertain';message:string;
 employeeId:string;marketId:string;before:JunkwareShift;correctionVersion:string;
 submittedAt?:string;verifiedAt?:string;history?:Array<{status:string;message:string;at:string}>;
};
const root=()=>path.join(process.env.OPSBOT_DATA_DIR||path.join(process.cwd(),'data'),'payroll_corrections','timecard-deletions');
export const correctionVersion=(row:PayrollCorrection|null)=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
function file(id:string){if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('Invalid deletion receipt.');return path.join(root(),`${id}.json`);}
export function readTimecardDelete(id:string):TimecardDeleteReceipt|null{try{return JSON.parse(fs.readFileSync(file(id),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
export function saveTimecardDelete(row:TimecardDeleteReceipt){fs.mkdirSync(root(),{recursive:true,mode:0o700});const target=file(row.id),temp=`${target}.${randomUUID()}.tmp`;const previous=readTimecardDelete(row.id);const immutable=(r:TimecardDeleteReceipt)=>JSON.stringify([r.id,r.actor,r.employeeName,r.workDate,r.employeeId,r.marketId,r.createdAt,r.expiresAt,r.before,r.correctionVersion]);if(previous&&immutable(previous)!==immutable(row))throw new Error('The deletion audit identity cannot change.');if(previous){const allowed:Record<string,string[]>={preview:['preview','submitted','failed'],submitted:['submitted','uncertain','verified'],uncertain:['uncertain','verified'],verified:['verified'],failed:['failed']};if(!allowed[previous.status]?.includes(row.status))throw new Error('Invalid deletion state transition.');if(previous.submittedAt&&previous.submittedAt!==row.submittedAt)throw new Error('The submission timestamp cannot change.');}const history=[...(previous?.history||[])];if(previous?.status!==row.status||previous?.message!==row.message)history.push({status:row.status,message:row.message,at:row.updatedAt});const descriptor=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(descriptor,JSON.stringify({...row,history}));fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}fs.renameSync(temp,target);const directory=fs.openSync(root(),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
export function timecardDeletes(date:string,name:string){if(!fs.existsSync(root()))return [];return fs.readdirSync(root()).filter(x=>/^[a-f0-9-]{36}\.json$/i.test(x)).map(x=>readTimecardDelete(x.slice(0,-5))!).filter(x=>x.workDate===date&&normalizePayrollEmployeeKey(x.employeeName)===normalizePayrollEmployeeKey(name)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
export function assertNoTimecardDeletion(date:string,name:string,exceptId?:string){if(timecardDeletes(date,name).some(x=>x.id!==exceptId&&['submitted','uncertain'].includes(x.status)))throw new Error('A timecard deletion is unconfirmed. Check its saved result before another change.');}
export function correctionWasDeleted(row:PayrollCorrection){return timecardDeletes(row.workDate,row.employeeName).some(x=>x.status==='verified'&&(x.correctionVersion===correctionVersion(row)||Date.parse(row.updatedAt)<=Date.parse(x.verifiedAt||'')));}
export function publicTimecardDelete(row:TimecardDeleteReceipt){return {id:row.id,employeeName:row.employeeName,workDate:row.workDate,status:row.status,message:row.message,expiresAt:row.expiresAt,verifiedAt:row.verifiedAt,before:{clockIn:row.before.clockIn,clockOut:row.before.clockOut,hourlyRate:row.before.hourlyRate}};}
export async function runTimecardDeleteWorker(args:string[]){const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx',path.join(process.cwd(),'scripts/timecard-delete-worker.ts'),...args],{cwd:process.cwd(),env:{...process.env},timeout:150000,maxBuffer:128000});return JSON.parse(stdout);}
