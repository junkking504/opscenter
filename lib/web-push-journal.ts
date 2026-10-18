import fs from 'node:fs';
import path from 'node:path';
import { pushEnabled } from './web-push-policy';
import { recordPushBatch, pushDependencies, type PushWorkerDependencies } from './web-push-worker';
import type { PushBatch } from './web-push-events';

const entryName=/^\d{16}\.json$/;
/** Reads immutable records, never a changing source snapshot. One consumer is
 * started only after acquiring dispatcher leadership. No recurring interval. */
export async function startPushJournal(root:string, deps?:PushWorkerDependencies, onFailure:()=>void=()=>{}) {
  if(!deps&&!pushEnabled())return {stop:async()=>{},disabled:true};
  const d=deps||pushDependencies();
  if(!d.enabled())return {stop:async()=>{},disabled:true};
  if(!path.isAbsolute(root))throw new Error('push_journal_directory_required');
  const ready=path.join(root,'ready'),archive=path.join(root,'archive');
  fs.mkdirSync(ready,{recursive:true,mode:0o700});fs.mkdirSync(archive,{recursive:true,mode:0o700});
  let alive=true,again=false,draining:Promise<void>|null=null;
  const fail=()=>{if(!alive)return;alive=false;watcher.close();onFailure();};
  const sync=(dir:string)=>{const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
  const prune=()=>{
    const files=fs.readdirSync(archive).filter(name=>entryName.test(name)).sort();
    let bytes=files.reduce((sum,name)=>sum+fs.statSync(path.join(archive,name)).size,0);
    for(const [i,name] of files.entries()){const stat=fs.statSync(path.join(archive,name));if(i<files.length-10000||bytes>128*1024*1024||stat.mtimeMs<Date.now()-7*86400000){fs.unlinkSync(path.join(archive,name));bytes-=stat.size;}}
    sync(archive);
  };
  const drain=async()=>{
    for(const name of fs.readdirSync(ready).filter(name=>entryName.test(name)).sort()){
      if(!alive||!d.enabled())return;
      const file=path.join(ready,name),stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.size>8*1024*1024)throw new Error('invalid_journal_entry');
      const entry=JSON.parse(fs.readFileSync(file,'utf8')) as {version:number;batches:PushBatch[]};
      if(entry.version!==1||!Array.isArray(entry.batches)||!entry.batches.length||entry.batches.length>4)throw new Error('invalid_journal_entry');
      for(const batch of entry.batches){
        // No PII or paths may cross the producer boundary into this consumer.
        if(!/^(schedule|krewe|fleet):\d{4}-\d{2}-\d{2}(?::market-(352|477|399|484))?$/.test(batch.scope)||typeof batch.complete!=='boolean'||!Array.isArray(batch.observations)||batch.observations.length>10000||batch.observations.some(row=>!/^[a-f0-9]{64}$/.test(row.identity)||typeof row.revision!=='string'||!/^[a-f0-9]{64}$/.test(row.revision)))throw new Error('invalid_journal_observation');
        if(!alive||!d.enabled())return;
        await recordPushBatch(batch,d);
      }
      // Crash before this rename replays the same sequences/digests safely.
      fs.renameSync(file,path.join(archive,name));sync(ready);sync(archive);
    }
    prune();
  };
  const wake=()=>{
    again=true;if(draining||!alive)return;
    draining=(async()=>{do{again=false;await drain();}while(again&&alive);})()
      .catch(()=>{console.error('Web Push journal stopped; retained records require recovery.');fail();})
      .finally(()=>{draining=null;if(again&&alive)wake();});
  };
  // Register before catch-up, closing the startup race. Each wake drains ALL
  // retained records, so OS coalescing never collapses intermediate revisions.
  const watcher=fs.watch(ready,wake);watcher.on('error',fail);
  wake();await draining;
  return {get active(){return alive;},wake,stop:async()=>{alive=false;watcher.close();await draining;}};
}
