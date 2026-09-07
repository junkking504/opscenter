import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chicagoDateKey} from './report-dates';

export type ScheduleSourceRequest = {state:'ready'|'loading'|'queued'|'failed';message:string};
export function scheduleDayNeedsCollection(date:string, observedAt:string|null, hasRows:boolean, now=Date.now()) {
  if (!observedAt && !hasRows) return true;
  if (date < chicagoDateKey(new Date(now))) return false;
  return !observedAt || !Number.isFinite(Date.parse(observedAt)) || now-Date.parse(observedAt)>300_000;
}
export function requestScheduleDay(date:string, observedAt:string|null, hasRows:boolean, force=false):ScheduleSourceRequest {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)!==date) throw new Error('A valid operating date is required.');
  const ready:ScheduleSourceRequest={state:'ready',message:''};
  const dataDir=process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '','.openclaw','workspace','opsbot','data');
  const control=path.join(dataDir,'schedule-requests');
  const statePath=path.join(control,`${date}.json`),lockPath=path.join(control,'active.json');
  const now=Date.now();
  const read=(file:string)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
  const previous=read(statePath),active=read(lockPath);
  if(active?.date===date && now-active.startedAt<210_000) return {state:'loading',message:`Loading ${date} from JunkWare…`};
  if(!force && !scheduleDayNeedsCollection(date,observedAt,hasRows,now))return ready;
  if(active && now-active.startedAt<210_000) return {state:'queued',message:`Waiting to load ${date} from JunkWare…`};
  if(previous?.state==='failed' && now-previous.finishedAt<60_000)return {state:'failed',message:'JunkWare could not verify this date. Available records are retained; retry shortly.'};
  fs.mkdirSync(control,{recursive:true,mode:0o700});
  if(active && read(lockPath)?.token===active.token) {try{fs.unlinkSync(lockPath);}catch{/* A concurrent request may have cleared it. */}}
  const token=randomUUID();
  try {fs.writeFileSync(lockPath,JSON.stringify({date,token,startedAt:now}),{flag:'wx',mode:0o600});}
  catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return {state:'queued',message:`Waiting to load ${date} from JunkWare…`};throw error;}
  const output=path.join(dataDir,'history','junkware',`junkware_schedule_requested_${date}.json`);
  const opsbotDir=process.env.OPSBOT_DIR || path.dirname(dataDir);
  execFile(process.env.OPSCENTER_PYTHON || 'python3',[path.join(process.cwd(),'scripts','collect-junkware-requested-day.py'),'--date',date,'--opsbot-dir',opsbotDir,'--output',output],{timeout:180_000,maxBuffer:1024*1024,env:{...process.env,PYTHONPYCACHEPREFIX:'/tmp/opscenter-schedule-pycache'}},error=>{
    try{fs.writeFileSync(statePath,JSON.stringify({state:error?'failed':'ready',finishedAt:Date.now()}),{mode:0o600});}
    catch{/* The verified snapshot remains the authority if status persistence fails. */}
    finally{if(read(lockPath)?.token===token){try{fs.unlinkSync(lockPath);}catch{/* Already released. */}}}
  });
  return {state:'loading',message:`Loading ${date} from JunkWare…`};
}
