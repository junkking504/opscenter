import assert from 'node:assert/strict';
import {cachedCommandSnapshot, commandSnapshotUrl, mergeCommandSummary} from '../desktop-ui/lib/command-loading';
import {clearWorkspaceCache, fetchWorkspace, WorkspaceReadError} from '../desktop-ui/lib/workspace-cache';
import {workspaceShell} from '../desktop-ui/lib/workspace-bootstrap';
import {createSettledPromiseCache} from '../lib/settled-promise-cache';
import type {DesktopCommandSnapshot} from '../desktop-ui/lib/live-contract';

async function main() {
  const originalFetch=globalThis.fetch, originalNow=Date.now;
  let time=Date.now(); Date.now=()=>time;
  const actor={displayName:'Synthetic operator',role:'Operator'};
  const day='2026-10-29',other='2026-10-30';
  const summary:DesktopCommandSnapshot={...workspaceShell({date:day,actor}),loading:false,updatesLoading:true,generatedAt:'2026-10-31T10:00:00Z',kpis:[{label:'Revenue',value:'$200.00',detail:'Saved source',progress:20,tone:'healthy'}],sources:{metrics:true,alerts:false,workflow:false}};
  const complete:DesktopCommandSnapshot={...summary,updatesLoading:undefined,generatedAt:'2026-10-31T09:00:00Z',alerts:[{id:'saved-alert'} as DesktopCommandSnapshot['alerts'][number]],sources:{metrics:true,alerts:true,workflow:true}};
  try {
    globalThis.fetch=async()=>Response.json(complete);
    await fetchWorkspace(commandSnapshotUrl(day),new AbortController().signal);
    assert.equal(cachedCommandSnapshot(day)?.alerts[0].id,'saved-alert');
    assert.equal(cachedCommandSnapshot(other),undefined,'Other dates cannot borrow cached facts');
    time++;
    globalThis.fetch=async()=>Response.json(summary);
    await fetchWorkspace(commandSnapshotUrl(day,true),new AbortController().signal);
    assert.equal(cachedCommandSnapshot(day)?.generatedAt,complete.generatedAt,'Summary refresh cannot renew feed verification time');
    assert.equal(cachedCommandSnapshot(day)?.sources.workflow,true);
    assert.deepEqual(mergeCommandSummary({...complete,date:other},summary),summary,'A changed date clears old alerts');
    assert.deepEqual(mergeCommandSummary(workspaceShell({date:day,actor}),summary),summary);
    clearWorkspaceCache();assert.equal(cachedCommandSnapshot(day),undefined,'Writes and auth invalidation clear every day');
    let resolve!:(r:Response)=>void;
    globalThis.fetch=()=>new Promise(r=>resolve=r);
    const pending=fetchWorkspace(commandSnapshotUrl(day),new AbortController().signal);
    clearWorkspaceCache(); resolve(Response.json(complete));await pending;
    assert.equal(cachedCommandSnapshot(day),undefined,'A pre-write response cannot repopulate invalidated cache');
    globalThis.fetch=async()=>Response.json(complete);
    await fetchWorkspace(commandSnapshotUrl(day),new AbortController().signal);
    globalThis.fetch=async()=>Response.json({error:'Authentication required'}, {status:401});
    await assert.rejects(fetchWorkspace(commandSnapshotUrl(other),new AbortController().signal),e=>e instanceof WorkspaceReadError && e.status===401);
    assert.equal(cachedCommandSnapshot(day),undefined);
    let loads=0;
    const cache=createSettledPromiseCache<number>(30_000,()=>time);
    const load=async()=>++loads;
    assert.equal(await cache('history',load,300_000),1);
    time+=30_001;assert.equal(await cache('history',load,300_000),1,'Historical TTL exceeds live TTL');
    assert.equal(await cache('history',load,300_000,true),2,'Explicit refresh bypasses settled historical cache');
    let release!:(n:number)=>void;
    const first=cache('pending',()=>new Promise(r=>release=r),300_000);
    await Promise.resolve();
    assert.equal(cache('pending',load,300_000,true),first,'Force shares pending work, never doubles remote requests');
    release(8);await first;
    time+=300_000;assert.equal(await cache('history',load,300_000),3,'Historical correction refresh is bounded');
    console.log('PASS command loading: per-date snapshots, independent summary, preserved verification time, write/auth invalidation including in-flight reads, historical TTL, explicit refresh and deduplication.');
  } finally {globalThis.fetch=originalFetch;Date.now=originalNow;clearWorkspaceCache();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
