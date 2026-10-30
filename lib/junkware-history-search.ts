import { spawn } from 'node:child_process';
import path from 'node:path';
import { historyQuery, type HistorySearch } from './junkware-history-contract';
import type { AppointmentSearchScope } from './global-search';
import { chicagoDateKey } from './report-dates';

export const HISTORY_UNAVAILABLE='JunkWare history could not be checked. Older appointments may be missing. Try again.';
type Request={query:string;scope:AppointmentSearchScope;today:string};
function runSearch(input:Request):Promise<HistorySearch>{
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx',path.join(process.cwd(),'scripts/search-junkware-history.ts')],{cwd:process.cwd(),env:{...process.env},stdio:['pipe','pipe','ignore'],detached:process.platform!=='win32'});
    let output='',failed=false;
    let escalation:ReturnType<typeof setTimeout>|undefined;
    const signal=(name:NodeJS.Signals)=>{try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,name);else child.kill(name);}catch{/* Already exited. */}};
    const stop=()=>{if(failed)return;failed=true;signal('SIGTERM');escalation=setTimeout(()=>signal('SIGKILL'),3000);};
    const timer=setTimeout(stop,70000);
    child.stdout.on('data',chunk=>{if(!failed){output+=chunk;if(output.length>512000)stop();}});
    child.stdin.on('error',()=>{});
    child.on('error',()=>{clearTimeout(timer);clearTimeout(escalation);reject(new Error(HISTORY_UNAVAILABLE));});
    child.on('close',code=>{
      clearTimeout(timer);
      clearTimeout(escalation);
      if(failed||code!==0)return reject(new Error(HISTORY_UNAVAILABLE));
      try{
        const result=JSON.parse(output) as HistorySearch;
        if(!Array.isArray(result.results)||result.results.length>100||typeof result.hasMore!=='boolean'||!Number.isFinite(Date.parse(result.checkedAt)))throw new Error();
        resolve(result);
      }catch{reject(new Error(HISTORY_UNAVAILABLE));}
    });
    child.stdin.end(JSON.stringify(input));
  });
}
/** Demand-driven only: short memory cache, coalesced identical lookups, bounded browsers. */
export function createHistoryLookup(run:(input:Request)=>Promise<HistorySearch>,now=Date.now){
  const cache=new Map<string,{at:number;value:HistorySearch}>();
  const pending=new Map<string,Promise<HistorySearch>>();
  return async(query:string,scope:AppointmentSearchScope,today=chicagoDateKey())=>{
    const search=historyQuery(query);
    if(!search)throw new Error('Use an address, JK number, phone, email, or surname: for JunkWare history.');
    const key=JSON.stringify([search.field,search.value.toLowerCase(),scope,today]);
    for(const [id,item]of cache)if(now()-item.at>=60000)cache.delete(id);
    const saved=cache.get(key);if(saved)return saved.value;
    const active=pending.get(key);if(active)return active;
    if(pending.size>=2)throw new Error(HISTORY_UNAVAILABLE);
    const job=run({query,scope,today}).then(value=>{
      while(cache.size>=32)cache.delete(cache.keys().next().value!);
      cache.set(key,{at:now(),value});return value;
    }).finally(()=>pending.delete(key));
    pending.set(key,job);return job;
  };
}
export const lookupJunkwareHistory=createHistoryLookup(runSearch);
