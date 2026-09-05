import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeLinxupV3Position } from './linxup-push';

export function linxupDataRoot() {
  return process.env.OPSCENTER_DATA_DIR || path.join(process.cwd(), 'data');
}
export const linxupQueueDirectory = (root: string) => path.join(root, 'history', 'linxup', 'pending');
const entryName = /^[a-f0-9]{64}\.json$/;
export function pendingLinxupPushes(root: string) {
  const directory = linxupQueueDirectory(root);
  try { return fs.readdirSync(directory).filter(name => entryName.test(name)).flatMap(name => {
    const file=path.join(directory,name);
    const stat=fs.statSync(file,{throwIfNoEntry:false});
    return stat?[{file,receivedAt:stat.mtimeMs}]:[];
  }).sort((a,b) => a.receivedAt-b.receivedAt || a.file.localeCompare(b.file)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
export function linxupPushQueueStatus(root: string) {
  try { const rows=pendingLinxupPushes(root); return {pending:rows.length,oldestAgeSeconds:rows.length?Math.max(0,Math.floor((Date.now()-rows[0].receivedAt)/1000)):null,readable:true}; }
  catch { return {pending:null,oldestAgeSeconds:null,readable:false}; }
}

export class InvalidLinxupPush extends Error {}

// Validate before acknowledging. The original payload stays private and is not
// considered a GPS observation until the locked normalizer has processed it.
export function enqueueLinxupPush(raw: string, root = linxupDataRoot()) {
  if (!raw || Buffer.byteLength(raw)>512*1024) throw new InvalidLinxupPush('Invalid payload size');
  let value: unknown;
  try { value=JSON.parse(raw); } catch { throw new InvalidLinxupPush('Invalid JSON'); }
  const payload=normalizeLinxupV3Position(value);
  if (!payload) throw new InvalidLinxupPush('Invalid position');
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(payload.positionDate));
  const map=JSON.parse(fs.readFileSync(path.join(root,'config','linxup_vehicle_map.json'),'utf8'));
  const id=String(payload.tracker.trackerId??payload.tracker.id??'').trim();
  const name=String(payload.tracker.name??'').trim().toLowerCase();
  const matches=(Array.isArray(map.mappings)?map.mappings:[]).filter((row: Record<string,unknown>) => row.status==='active'
    && String(row.effective_start_date)<=date && (!row.effective_end_date || String(row.effective_end_date)>=date)
    // V3 trackerId and V2 device UUID are different identifiers on this account.
    // Preserve the existing exact-name mapping and reject ambiguous matches.
    && ((Boolean(id)&&String(row.linxup_tracker_id).trim()===id) || (Boolean(name)&&String(row.linxup_vehicle_name).trim().toLowerCase()===name)));
  if(matches.length!==1) throw new InvalidLinxupPush('Unmapped or ambiguous tracker');
  const directory=linxupQueueDirectory(root);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const idempotencyKey=crypto.createHash('sha256').update(raw).digest('hex');
  const file=path.join(directory,`${idempotencyKey}.json`);
  if(fs.existsSync(file)) return {queued:true,duplicate:true};
  if(pendingLinxupPushes(root).length>=1000) throw new Error('Queue capacity reached');
  const temporary=path.join(directory,`.${crypto.randomUUID()}.tmp`);
  try {
    const fd=fs.openSync(temporary,'wx',0o600);
    try { fs.writeFileSync(fd,raw); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    // Atomic no-replace publication: concurrent retries cannot overwrite an
    // entry being processed or reset its original receipt timestamp.
    try { fs.linkSync(temporary,file); } catch(error) { if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error; }
    const dir=fs.openSync(directory,'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally { fs.rmSync(temporary,{force:true}); }
  return {queued:true,duplicate:false};
}

// Caller must hold linxup_live_refresh.lock. A failed entry remains durable and
// does not block other trucks; success requires normalized snapshot persistence.
export function drainLinxupPushes(root: string, processEntry: (file:string,receivedAt:string)=>string, limit=100) {
  let processed=0,failed=0;
  const dates=new Set<string>();
  for(const row of pendingLinxupPushes(root).slice(0,limit)) {
    try { const date=processEntry(row.file,new Date(row.receivedAt).toISOString()); dates.add(date); fs.unlinkSync(row.file); processed++; }
    catch { failed++; }
  }
  return {processed,failed,remaining:pendingLinxupPushes(root).length,dates:[...dates].sort()};
}
