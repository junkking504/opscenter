import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cachedWorkspace, clearWorkspaceCache, fetchWorkspace } from '../desktop-ui/lib/workspace-cache';
import { workspaceShell } from '../desktop-ui/lib/workspace-bootstrap';
import { desktopWorkspacePreloads } from '../lib/desktop-release';
import { readRetainedDesktopAsset } from '../lib/desktop-retained-assets';

async function main() {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let time = originalNow();
  Date.now = () => time;
  const signal = new AbortController().signal;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ date: '2026-09-11', sourceAt: '2026-09-11T12:00:00Z', version: calls }); };
    const first = await fetchWorkspace<{ version: number }>('/api/desktop/fleet?date=A', signal);
    assert.equal(cachedWorkspace<typeof first>('/api/desktop/fleet?date=A')?.value.version, 1);
    assert.equal(cachedWorkspace('/api/desktop/fleet?date=B'), undefined, 'Different dates never share records');
    const receivedAt = cachedWorkspace('/api/desktop/fleet?date=A')!.receivedAt;
    time += 2000;
    assert.equal(cachedWorkspace('/api/desktop/fleet?date=A')!.receivedAt, receivedAt, 'A cache hit must not reset freshness');
    await fetchWorkspace('/api/desktop/fleet?date=A', signal);
    assert.equal(calls, 2, 'Refresh always reads the source even with a cached screen');
    globalThis.fetch = async () => Response.json({ error: 'offline' }, { status: 503 });
    await assert.rejects(fetchWorkspace('/api/desktop/fleet?date=A', signal));
    assert.equal(cachedWorkspace<{version:number}>('/api/desktop/fleet?date=A')!.value.version, 2, 'Failure retains the verified snapshot');
    globalThis.fetch = async () => Response.json({error:'denied'}, {status:403});
    await assert.rejects(fetchWorkspace('/api/desktop/fleet?date=A', signal));
    assert.equal(cachedWorkspace('/api/desktop/fleet?date=A'), undefined, 'Lost authorization clears cache');
    let complete!: (response: Response) => void;
    globalThis.fetch = () => new Promise(resolve => { complete = resolve; });
    const pending = fetchWorkspace('/api/desktop/fleet?date=A', signal);
    const shared = fetchWorkspace('/api/desktop/fleet?date=A', signal);
    clearWorkspaceCache(); complete(Response.json({version:'before write'})); assert.deepEqual(await pending,await shared,'Concurrent foreground and warm reads share one response');
    assert.equal(cachedWorkspace('/api/desktop/fleet?date=A'), undefined, 'In-flight reads cannot repopulate a cache invalidated by a write');
    const readers = new Map<string, (response: Response) => void>();
    globalThis.fetch = input => new Promise(resolve => { readers.set(String(input), resolve); });
    const warmUrl = '/api/desktop/schedule?date=A';
    const sourceUrl = `${warmUrl}&load=1`;
    const warmRead = fetchWorkspace(warmUrl, signal, sourceUrl);
    const sourceRead = fetchWorkspace(sourceUrl, signal, sourceUrl);
    assert.equal(readers.size, 2, 'A saved-board read cannot swallow the foreground source request');
    readers.get(sourceUrl)!(Response.json({ version: 'source-refresh' }));
    await sourceRead;
    readers.get(warmUrl)!(Response.json({ version: 'older-warm-read' }));
    await warmRead;
    assert.equal(cachedWorkspace<{version:string}>(sourceUrl)!.value.version, 'source-refresh', 'A late background response cannot overwrite a newer foreground snapshot');
    globalThis.fetch = async () => Response.json({version:3});
    await fetchWorkspace('/api/desktop/fleet?date=A', signal);
    time += 5 * 60_000 + 1;
    assert.equal(cachedWorkspace('/api/desktop/fleet?date=A'), undefined, 'Cache lifetime is bounded');
    for (let i=0;i<20;i++) await fetchWorkspace(`/api/desktop/fleet?date=${i}`, signal);
    assert.equal(cachedWorkspace('/api/desktop/fleet?date=0'), undefined, 'LRU eviction bounds retained records');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(fetchWorkspace('/api/desktop/fleet?date=aborted', controller.signal));
    assert.equal(cachedWorkspace('/api/desktop/fleet?date=aborted'), undefined);
    const shell = workspaceShell({date:'2026-09-11',actor:{displayName:'Test operator',role:'Operator'}});
    assert.equal(shell.loading,true); assert.equal(shell.actor.role,'Operator');
    assert.deepEqual(shell.kpis,[]); assert.deepEqual(shell.alerts,[]);
    assert.equal(shell.sources.alerts,false); assert.equal(shell.generatedAt,'');
    console.log('PASS: date isolation, original freshness, revalidation, failure retention, authorization loss, write races, TTL, LRU, aborts, truthful bootstrap');
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; clearWorkspaceCache(); }
  const preloads = desktopWorkspacePreloads({
    'live-fleet.tsx': {file:'assets/live-fleet-abcdefgh.js',imports:['shared','index.html'],css:['assets/fleet-abcdefgh.css']},
    shared:{file:'assets/shared-abcdefgh.js',imports:['live-fleet.tsx']},
    'index.html':{file:'assets/index-abcdefgh.js'},
  },'Fleet');
  assert.ok(preloads.includes('live-fleet-abcdefgh.js') && preloads.includes('shared-abcdefgh.js') && preloads.includes('stylesheet'));
  assert.ok(!preloads.includes('index-abcdefgh.js'));
  assert.equal(desktopWorkspacePreloads({},'<script>'), '');
  console.log('PASS: selected workspace preload, shared dependencies, cycles, stylesheet hints, unknown workspace');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'ops-asset-test-'));
  try {
    const old = path.join(temp,'releases','a'.repeat(40));
    const current = path.join(temp,'releases','b'.repeat(40));
    await fs.mkdir(path.join(old,'public/desktop-assets/assets'),{recursive:true}); await fs.mkdir(current,{recursive:true});
    await fs.writeFile(path.join(old,'public/desktop-assets/assets/live-fleet-abcdefgh.js'),'export const oldRelease = true;');
    assert.equal((await readRetainedDesktopAsset('live-fleet-abcdefgh.js',current))?.toString(),'export const oldRelease = true;');
    for(const asset of ['../../production.env','index.html','test.map','live-fleet-missing1.js']) assert.equal(await readRetainedDesktopAsset(asset,current),null);
    assert.equal(await readRetainedDesktopAsset('live-fleet-abcdefgh.js',temp),null,'Source checkouts cannot scan adjacent worktrees');
    console.log('PASS: retained code retrieval, missing assets, traversal rejection, source-checkout isolation');
  } finally { await fs.rm(temp,{recursive:true,force:true}); }
}
void main();
