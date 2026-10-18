import fs from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { pushEnabled } from './web-push-policy';
import { recordPushBatch,recordPushGap,deterministicPushErrors,pushDependencies,type PushWorkerDependencies } from './web-push-worker';
import type { PushBatch } from './web-push-events';
const entryName=/^\d{16}\.json$/;
const scopePattern=/^(schedule|krewe|fleet):\d{4}-\d{2}-\d{2}(?::market-(352|477|399|484))?$/;
const sync=(dir:string)=>{const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
function atomic(file:string,value:unknown){
  const temporary=file+'.'+randomUUID()+'.tmp',fd=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);sync(path.dirname(file));
}
function validate(batch:PushBatch){
  if(!batch||!scopePattern.test(batch.scope)||!batch.scope.startsWith(batch.category+':')||typeof batch.complete!=='boolean'||!Array.isArray(batch.observations)||batch.observations.length>10000||batch.observations.some(row=>!row||!/^[a-f0-9]{64}$/.test(row.identity)||typeof row.revision!=='string'||!/^[a-f0-9]{64}$/.test(row.revision)))throw new Error('invalid_journal_observation');
}
/** Retained records, one leader, no timer. Deterministic failures quarantine
 * locally and preserve sticky coverage gaps; only transient failures stop I/O. */
export async function startPushJournal(root:string,deps?:PushWorkerDependencies,onFailure:()=>void=()=>{},recoverPending:()=>Promise<void>=async()=>{},maintain:()=>Promise<void>=async()=>{}) {
  if(!deps&&!pushEnabled())return {stop:async()=>{},disabled:true};
  const d=deps||pushDependencies();if(!d.enabled())return {stop:async()=>{},disabled:true};
  if(!path.isAbsolute(root))throw new Error('push_journal_directory_required');
  const ready=path.join(root,'ready'),archive=path.join(root,'archive'),quarantine=path.join(root,'quarantine'),gaps=path.join(root,'gaps'),pending=path.join(root,'pending');
  for(const directory of [ready,archive,quarantine,gaps,pending])fs.mkdirSync(directory,{recursive:true,mode:0o700});
  let alive=true,again=false,draining:Promise<void>|null=null;
  const watchers:fs.FSWatcher[]=[];
  const fail=()=>{if(!alive)return;alive=false;for(const watcher of watchers)watcher.close();onFailure();};
  const prune=(directory:string)=>{
    const files=fs.readdirSync(directory).filter(name=>entryName.test(name)).sort();
    let bytes=files.reduce((sum,name)=>sum+fs.lstatSync(path.join(directory,name)).size,0);
    for(const [i,name] of files.entries()){const stat=fs.lstatSync(path.join(directory,name));if(i<files.length-10000||bytes>128*1024*1024||stat.mtimeMs<Date.now()-14*86400000){fs.unlinkSync(path.join(directory,name));bytes-=stat.size;}}
    sync(directory);
  };
  const gap=async(scope:unknown,code:string)=>{
    let target=typeof scope==='string'&&scopePattern.test(scope)?scope:'journal:global';
    if(fs.readdirSync(gaps).length>=1000&&!fs.existsSync(path.join(gaps,createHash('sha256').update(target).digest('hex')+'.json')))target='journal:capacity';
    const id=randomUUID().replaceAll('-','');
    atomic(path.join(gaps,createHash('sha256').update(target).digest('hex')+'.json'),{scope:target,id,code,observedAt:new Date().toISOString(),reset:!target.startsWith('journal:')});
    await recordPushGap(target,id,code,d);
  };
  const processedGaps=new Map<string,string>();
  const readGaps=async()=>{
    const names=fs.readdirSync(gaps).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
    const present=new Set(names);for(const name of processedGaps.keys())if(!present.has(name))processedGaps.delete(name);
    for(const name of names){
      const file=path.join(gaps,name),stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.size>4096)continue;
      let value:{scope:string;id:string;code:string};try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{continue;}
      if(value&&typeof value.scope==='string'&&typeof value.id==='string'&&/^[a-f0-9]{32}$/.test(value.id)&&typeof value.code==='string'&&processedGaps.get(name)!==value.id){await recordPushGap(value.scope,value.id,value.code,d);processedGaps.set(name,value.id);}
    }
  };
  const drain=async()=>{
    if(fs.readdirSync(pending).some(name=>name.endsWith('.json')||name.endsWith('.prepared')))await recoverPending();
    await readGaps();
    for(const name of fs.readdirSync(ready).filter(name=>entryName.test(name)).sort()){
      if(!alive||!d.enabled())return;
      const file=path.join(ready,name);let damaged=false;
      let entry:{version:number;batches:PushBatch[]};
      try{
        const stat=fs.lstatSync(file);
        if(!stat.isFile()||stat.size>8*1024*1024)throw new Error('invalid_journal_entry');
        entry=JSON.parse(fs.readFileSync(file,'utf8'));
        if(!entry||![1,2].includes(entry.version)||!Array.isArray(entry.batches)||!entry.batches.length||entry.batches.length>4)throw new Error('invalid_journal_entry');
      }catch(error){
        if(!(error instanceof SyntaxError)&&!deterministicPushErrors.has((error as Error).message))throw error;
        await gap('journal:global','invalid_journal_entry');
        fs.renameSync(file,path.join(quarantine,name));sync(ready);sync(quarantine);continue;
      }
      for(const batch of entry.batches){
        if(!alive||!d.enabled())return;
        try{validate(batch);await recordPushBatch(batch,d);}
        catch(error){
          const code=(error as Error).message;
          if(!deterministicPushErrors.has(code))throw error;
          await gap(batch?.scope,code);damaged=true;
          // Continue valid scopes in the SAME file as well as later entries.
        }
      }
      const destination=damaged?quarantine:archive;
      fs.renameSync(file,path.join(destination,name));sync(ready);sync(destination);
    }
    // Only acknowledged entries may expire. Quarantine remains evidence and
    // blocks source retirement until an explicitly reviewed disposition.
    prune(archive);
    await maintain();
  };
  const wake=()=>{
    again=true;if(draining||!alive)return;
    draining=(async()=>{do{again=false;await drain();}while(again&&alive);})()
      .catch(()=>{console.error('Web Push journal unavailable; retained records await recovery.');fail();})
      .finally(()=>{draining=null;if(again&&alive)wake();});
  };
  for(const directory of [ready,gaps,pending]){const watcher=fs.watch(directory,wake);watcher.on('error',fail);watchers.push(watcher);}
  wake();await draining;
  return {get active(){return alive;},wake,stop:async()=>{alive=false;for(const watcher of watchers)watcher.close();await draining;}};
}
