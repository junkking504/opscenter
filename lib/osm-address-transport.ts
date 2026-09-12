import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

type Lookup = { payload: unknown; retryAfterMs?: number };
const SLOT_MS = 20_000;
// A single shared disk reservation admits one request in the first five seconds
// of each 20-second slot. Starts are >=15 seconds apart across server/collector
// processes; a crashed process cannot strand a lock. Requests time out at 8s.
export async function osmAddressJson(endpoint: 'search' | 'reverse', params: URLSearchParams, waitBudgetMs=0): Promise<Lookup> {
  if(process.env.OPSCENTER_OSM_ADDRESS_LOOKUPS === 'off')return {payload:null,retryAfterMs:300_000};
  const root=process.env.OSM_ADDRESS_CACHE_DIR || path.join(process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data'),'cache/osm-address-lookups');
  const now=Date.now(),slot=Math.floor(now/SLOT_MS),phase=now%SLOT_MS;
  const file=path.join(root,createHash('sha256').update(endpoint+'?'+params).digest('hex')+'.json');
  try {
    const cached=JSON.parse(fs.readFileSync(file,'utf8'));
    if(cached.expires>now)return {payload:cached.payload,...(cached.retryable?{retryAfterMs:cached.expires-now}:{})};
  } catch { /* An absent cache enters the bounded provider path. */ }
  if(phase>=5000) {
    const wait=SLOT_MS-phase+100;
    if(wait>waitBudgetMs)return {payload:null,retryAfterMs:wait};
    await new Promise(resolve=>setTimeout(resolve,wait));
    // Recheck the disk cache and reservation after the wait. This also prevents
    // a fixed-cadence background caller from repeatedly missing admission.
    return osmAddressJson(endpoint,params);
  }
  try {
    const reservations=path.join(root,'reservations');fs.mkdirSync(reservations,{recursive:true});
    fs.mkdirSync(path.join(reservations,String(slot)));
    for(const old of fs.readdirSync(reservations))if(/^\d+$/.test(old) && Number(old)<slot-6) {
      try {fs.rmdirSync(path.join(reservations,old));} catch { /* Another process may have pruned this empty reservation. */ }
    }
  } catch {return {payload:null,retryAfterMs:SLOT_MS-phase+100};}
  let payload:unknown=null,failed=false;
  try {
    const response=await fetch(`https://nominatim.openstreetmap.org/${endpoint}?${params}`,{
      headers:{'User-Agent':'JunkKing-OpsCenter/1.0 (https://ops.junk-king.app)'},signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store',
    });
    if(response.ok)payload=await response.json();else failed=true;
  } catch {failed=true;}
  const ttl=failed?60_000:endpoint==='reverse'?600_000:Array.isArray(payload)&&payload.length?7*86400_000:6*3600_000;
  const temp=file+'.'+randomUUID()+'.tmp';
  try {fs.writeFileSync(temp,JSON.stringify({expires:Date.now()+ttl,payload,retryable:failed}),{mode:0o660});fs.renameSync(temp,file);} catch {try{fs.unlinkSync(temp);}catch{/* Provider result remains usable. */}}
  return {payload,...(failed?{retryAfterMs:60_000}:{})};
}
