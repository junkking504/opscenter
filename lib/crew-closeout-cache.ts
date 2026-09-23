import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export type CloseoutCacheScope={assignmentId:string;appointmentId:string;date:string;truck:string};
export type SavedCrewCloseout={scope:CloseoutCacheScope;savedAt:string;closeout:Record<string,unknown>;arrival:string|null;jobVersion:string};
const root=()=>path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'crew-closeout-cache');
const key=(scope:CloseoutCacheScope)=>createHash('sha256').update(JSON.stringify(scope)).digest('hex');
const file=(scope:CloseoutCacheScope)=>path.join(root(),`${key(scope)}.json`);
const pending=new Map<string,Promise<SavedCrewCloseout>>();
export function readSavedCrewCloseout(scope:CloseoutCacheScope,now=Date.now()):SavedCrewCloseout|null {
  try {
    const value=JSON.parse(fs.readFileSync(file(scope),'utf8'));
    const age=now-Date.parse(value.savedAt);
    return value.schema===1 && JSON.stringify(value.scope)===JSON.stringify(scope) && age>=0 && age<24*60*60_000
      && value.closeout && typeof value.jobVersion==='string' ? value : null;
  }catch{return null;}
}
export function forgetSavedCrewCloseout(scope:CloseoutCacheScope) {fs.rmSync(file(scope),{force:true});}
/** A private, appointment-bound form snapshot, never permission to write. */
export async function savedCrewCloseout(scope:CloseoutCacheScope,refresh:boolean,read:()=>Promise<Omit<SavedCrewCloseout,'scope'|'savedAt'>>) {
  const id=key(scope);
  // Join the same read; every caller must independently recheck phone authority.
  if(pending.has(id))return pending.get(id)!;
  const saved=!refresh && readSavedCrewCloseout(scope);
  if(saved)return saved;
  const task=(async()=>{
    const value={...await read(),scope,savedAt:new Date().toISOString(),schema:1};
    fs.mkdirSync(root(),{recursive:true,mode:0o700});
    const temp=`${file(scope)}.${randomUUID()}.tmp`;
    try{fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file(scope));}
    finally{fs.rmSync(temp,{force:true});}
    return value;
  })().finally(()=>pending.delete(id));
  pending.set(id,task);return task;
}
