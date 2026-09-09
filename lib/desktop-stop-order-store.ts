import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { stopGroups, stopGroupKey, stopOrderSourceKey, isStopPermutation, type OrderedStop } from './schedule-stop-order';

const directory = () => process.env.SCHEDULE_STOP_ORDER_DIR || path.join(process.cwd(),'data','schedule-stop-order');
const fileFor = (date: string, group: string) => path.join(directory(),date,createHash('sha256').update(group).digest('hex')+'.json');
export class StopOrderConflict extends Error {}
function readIds(file: string): string[] {
  try {
    const data = JSON.parse(fs.readFileSync(file,'utf8'));
    if (!Array.isArray(data.ids) || !data.ids.every((id: unknown)=>typeof id === 'string') || new Set(data.ids).size !== data.ids.length) throw new Error('Invalid saved stop order.');
    return data.ids;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
export function applyStopOrders<T extends OrderedStop>(date: string, jobs: T[]): T[] {
  const ranks = new Map<string,number>();
  for (const group of stopGroups(jobs)) {
    const saved = readIds(fileFor(date,stopGroupKey(group[0]))).filter(id=>group.some(job=>job.recordId === id));
    if (!saved.length) continue;
    const ids = [...saved,...group.filter(job=>!saved.includes(job.recordId)).map(job=>job.recordId)];
    ids.forEach((id,index)=>ranks.set(id,index));
  }
  return jobs.map(job=>({...job,stopOrder:ranks.get(job.recordId)}));
}

// A separate atomic file per date/truck/window prevents unrelated edits from
// overwriting one another. Re-read source inside the cross-process lock.
export function saveStopOrder<T extends OrderedStop>(input: {date: string; groupKey: string; sourceKey: string; ids: string[]; actor: string}, readCurrent: ()=>T[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Invalid operating date.');
  const file = fileFor(input.date,input.groupKey), lock = file+'.lock';
  fs.mkdirSync(path.dirname(file),{recursive:true});
  let fd: number;
  try { fd = fs.openSync(lock,'wx',0o660); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StopOrderConflict('Another stop order is being saved. Refresh and try again.'); throw error; }
  const temporary = file+'.'+randomUUID()+'.tmp';
  try {
    const group = stopGroups(readCurrent()).find(group=>stopGroupKey(group[0]) === input.groupKey);
    if (!group || stopOrderSourceKey(group) !== input.sourceKey) throw new StopOrderConflict('The schedule or stop order changed. Refresh and review the current stops.');
    if (!isStopPermutation(group,input.ids)) throw new Error('Include every appointment in this time slot exactly once.');
    fs.writeFileSync(temporary,JSON.stringify({ids:input.ids,updatedAt:new Date().toISOString(),actor:input.actor}),{mode:0o660});
    fs.chmodSync(temporary,0o660);
    fs.renameSync(temporary,file);
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
