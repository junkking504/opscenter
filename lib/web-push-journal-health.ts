import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

// Match producer admission guards; this is queue headroom, not a disk quota.
export const PUSH_QUEUE_LIMITS={files:10000,bytes:128*1024*1024};
const groups=[
  {key:'ready',directories:['ready','quarantine']},
  {key:'pending',directories:['pending','pending-quarantine']},
  {key:'uncertain',directories:['uncertain']},
] as const;
export type PushQueueCapacity={key:'ready'|'pending'|'uncertain';status:'observed'|'unknown';files:number|null;bytes:number|null;remainingFiles:number|null;remainingBytes:number|null;limitFiles:number;limitBytes:number};
export type PushJournalHealth={configured:boolean;sampledAt:string;status:'observed'|'unknown';capacity:PushQueueCapacity[];retention:{status:'observed'|'unknown';unscopableRetained:number|null;scannedAt:string|null}};
const unknownRetention=():PushJournalHealth['retention']=>({status:'unknown',unscopableRetained:null,scannedAt:null});
const unknownCapacity=(key:PushQueueCapacity['key']):PushQueueCapacity=>({key,status:'unknown',files:null,bytes:null,remainingFiles:null,remainingBytes:null,limitFiles:PUSH_QUEUE_LIMITS.files,limitBytes:PUSH_QUEUE_LIMITS.bytes});
const signature=(s:{ino:number;mtimeMs:number;ctimeMs:number})=>`${s.ino}:${s.mtimeMs}:${s.ctimeMs}`;
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';

/** Read only, on existing settings requests. Never follows evidence symlinks,
 * reads source facts, runs the producer, provisions directories or starts timers.
 * Samples are not atomic: directory changes during a scan invalidate that group.
 */
export async function readPushJournalHealth(root=process.env.OPSCENTER_WEB_PUSH_JOURNAL_DIR):Promise<PushJournalHealth> {
  const result:PushJournalHealth={configured:Boolean(root),sampledAt:new Date().toISOString(),status:'unknown',capacity:groups.map(g=>unknownCapacity(g.key)),retention:unknownRetention()};
  if(!root||!path.isAbsolute(root))return result;
  try {
    const rootStat=await fs.lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())return result;
    const directoryState=async(directory:string)=>{
      try {const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('invalid_directory');return signature(stat);}
      catch(error){if(missing(error))return null;throw error;}
    };
    result.capacity=await Promise.all(groups.map(async group=>{
      const unknown=unknownCapacity(group.key);
      try {
        const directories=group.directories.map(name=>path.join(root,name));
        const before=await Promise.all(directories.map(directoryState));
        let files=0,bytes=0,visited=0;
        for(const [index,directory] of directories.entries()){
          if(before[index]===null)continue; // Producer lazily creates these directories.
          for await(const entry of await fs.opendir(directory)){
            // Bound metadata work, including unexpected names. Never return a
            // partial count as spare capacity if the scan limit is reached.
            if(++visited>20002)throw new Error('scan_limit');
            if(!entry.name.endsWith('.json')&&!(path.basename(directory)==='pending'&&entry.name.endsWith('.prepared')))continue;
            const stat=await fs.lstat(path.join(directory,entry.name));
            if(!stat.isFile()||stat.isSymbolicLink()||!Number.isSafeInteger(stat.size)||stat.size<0)throw new Error('invalid_entry');
            files++;bytes+=stat.size;if(!Number.isSafeInteger(bytes))throw new Error('invalid_size');
          }
        }
        const after=await Promise.all(directories.map(directoryState));
        if(before.some((value,index)=>value!==after[index]))throw new Error('changed_during_scan');
        return {...unknown,status:'observed' as const,files,bytes,remainingFiles:Math.max(0,PUSH_QUEUE_LIMITS.files-files),remainingBytes:Math.max(0,PUSH_QUEUE_LIMITS.bytes-bytes)};
      }catch{return unknown;}
    }));
    // This count belongs to the last retention scan, not the capacity sample.
    // O_NOFOLLOW and a fixed read bound avoid following or loading private files.
    try {
      const handle=await fs.open(path.join(root,'retention-audit.json'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      try {
        const stat=await handle.stat();
        if(!stat.isFile()||stat.size>65536||stat.mtimeMs>Date.now())throw new Error('invalid_audit');
        const buffer=Buffer.alloc(65537);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
        if(bytesRead!==stat.size||signature(stat)!==signature(await handle.stat()))throw new Error('changed_audit');
        const audit=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
        if(!Number.isSafeInteger(audit?.unscopableRetained)||audit.unscopableRetained<0)throw new Error('invalid_count');
        result.retention={status:'observed',unscopableRetained:audit.unscopableRetained,scannedAt:stat.mtime.toISOString()};
      }finally{await handle.close();}
    }catch{/* Missing, malformed or unreadable is unknown, never zero. */}
    const rootAfter=await fs.lstat(root);
    if(rootAfter.ino!==rootStat.ino||!rootAfter.isDirectory()||rootAfter.isSymbolicLink())throw new Error('changed_root');
    result.status='observed';return result;
  }catch{return {...result,status:'unknown',capacity:groups.map(g=>unknownCapacity(g.key)),retention:unknownRetention()};}
}
