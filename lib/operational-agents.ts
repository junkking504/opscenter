import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readVisitTrackingAgent} from './visit-tracking-reader';
import {readOperationalTruckExpenses,type TruckExpense} from './truck-expense-notifications';
import {readDumpFeePolicy} from './dump-expenses';
import {runUnloadCostAgent,uniqueTrackedVisits} from './unload-cost-agent';
import type {TrackedVisit} from './visit-tracking-agent';

type Watermarks=Record<string,number>;
type TrackingResult={agentId:'visit-tracking';date:string;visits:TrackedVisit[];sourceHealth:Record<string,unknown>;complete:boolean};
type CostResult=ReturnType<typeof runUnloadCostAgent>;
type AgentState<T>={status:'ok'|'degraded'|'error'|'stale_inputs';heartbeatAt:string;lastSuccessAt:string|null;watermarks:Watermarks;result:T|null;error?:string;dependency?:'current'|'retained'|'unavailable'};
export type OperationalAgentState={version:1;date:string;updatedAt:string;agents:{'visit-tracking':AgentState<TrackingResult>;'unload-cost':AgentState<CostResult>}};
const root=()=>process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data');
const daysFor=(date:string)=>[-1,0,1].map(offset=>new Date(Date.parse(`${date}T12:00:00Z`)+offset*86_400_000).toISOString().slice(0,10));
const validTime=(value:unknown)=>Number.isFinite(Date.parse(String(value||'')))?Date.parse(String(value)):0;
export function readTrackingInputs(date:string) {
  const snapshots=daysFor(date).map(day=>readVisitTrackingAgent(day)),watermarks:Watermarks={};
  for(const snapshot of snapshots) for(const [name,value] of Object.entries(snapshot.sourceHealth)) {
    if(name.endsWith('At'))watermarks[`${snapshot.date}:${name}`]=validTime(value);
  }
  const selected=snapshots[1];
  return {watermarks,result:{...selected,visits:uniqueTrackedVisits(snapshots.flatMap(snapshot=>snapshot.visits)),sourceHealth:Object.fromEntries(snapshots.map(snapshot=>[snapshot.date,snapshot.sourceHealth]))} as TrackingResult};
}
export function readExpenseInputs(date:string) {
  const days=daysFor(date),watermarks:Watermarks={};
  for(const day of days)for(const market of ['352','477','399','484']) {
    const directory=path.join(root(),'history','junkware','expenses',day,market);
    let files:string[]=[];try{files=fs.readdirSync(directory).filter(file=>/^\d+\.json$/.test(file));}catch{continue;}
    for(const file of files) {
      try {
        const data=JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
        if(data.date===day && data.market===market && data.verified===true && data.truck===`Truck# ${file.slice(0,-5)}`)
          watermarks[`${day}:${market}:${file}`]=validTime(data.observedAt);
      }catch{/* Missing or damaged snapshots cannot advance a source watermark. */}
    }
  }
  return {expenses:days.flatMap(readOperationalTruckExpenses),watermarks};
}
const regressed=(before:Watermarks,after:Watermarks)=>Object.entries(before).some(([key,value])=>(after[key]||0)<value);
const failed=<T>(old:AgentState<T>|undefined,stamp:string,error:string,status:'error'|'stale_inputs'='error'):AgentState<T>=>({...old,status,heartbeatAt:stamp,lastSuccessAt:old?.lastSuccessAt||null,watermarks:old?.watermarks||{},result:old?.result||null,error});

/** Called under the OS ownership lock by the existing refresh/push workflows.
 * Each agent fails independently; no provider, daemon, message or ledger write. */
export function runOperationalAgents(date:string,options:{now?:number;readTracking?:(date:string)=>{result:TrackingResult;watermarks:Watermarks};readExpenses?:(date:string)=>{expenses:TruckExpense[];watermarks:Watermarks}}={}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Choose a valid operational day.');
  const file=path.join(root(),'fleet','agents',`${date}.json`);
  let prior:OperationalAgentState|undefined;
  try{const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.version===1 && value.date===date)prior=value;}catch{/* First run has no retained result. */}
  const now=options.now??Date.now(),stamp=new Date(now).toISOString();
  if(prior && validTime(prior.updatedAt)>now)return prior;
  let tracking:AgentState<TrackingResult>;
  try {
    const input=(options.readTracking||readTrackingInputs)(date);
    if(regressed(prior?.agents['visit-tracking'].watermarks||{},input.watermarks))tracking=failed(prior?.agents['visit-tracking'],stamp,'Visit source evidence is older than the retained result.','stale_inputs');
    else tracking={status:input.result.complete?'ok':'degraded',heartbeatAt:stamp,lastSuccessAt:stamp,watermarks:input.watermarks,result:input.result};
  }catch(error){tracking=failed(prior?.agents['visit-tracking'],stamp,error instanceof Error?error.message:'Visit tracking failed.');}
  let cost:AgentState<CostResult>;
  try {
    const input=(options.readExpenses||readExpenseInputs)(date);
    if(regressed(prior?.agents['unload-cost'].watermarks||{},input.watermarks))cost=failed(prior?.agents['unload-cost'],stamp,'Expense evidence is older than the retained result.','stale_inputs');
    else {
      const dependency=!tracking.result?'unavailable':['ok','degraded'].includes(tracking.status)?'current':'retained';
      const result=runUnloadCostAgent(date,tracking.result?.visits||[],input.expenses,readDumpFeePolicy(),now);
      cost={status:dependency==='current' && !result.needsReviewCount && !result.missingMinimumCount?'ok':'degraded',heartbeatAt:stamp,lastSuccessAt:stamp,watermarks:input.watermarks,result,dependency};
    }
  }catch(error){cost=failed(prior?.agents['unload-cost'],stamp,error instanceof Error?error.message:'Unload/cost processing failed.');}
  const state:OperationalAgentState={version:1,date,updatedAt:stamp,agents:{'visit-tracking':tracking,'unload-cost':cost}};
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temporary=`${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const descriptor=fs.openSync(temporary,'wx',0o600);
    try{fs.writeFileSync(descriptor,JSON.stringify(state,null,2)+'\n');fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
    fs.renameSync(temporary,file);
    const directory=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  }finally{try{fs.unlinkSync(temporary);}catch{/* Renamed successfully. */}}
  return state;
}
