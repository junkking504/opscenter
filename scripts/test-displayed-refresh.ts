import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDisplayedRefreshRegistry } from '../desktop-ui/displayed-refresh';

async function main() {
const registry = createDisplayedRefreshRegistry(40);
let notifications = 0;
const unsubscribe = registry.subscribe(() => notifications++);
assert.equal(registry.available('Finance'), false);
await assert.rejects(registry.refresh('Finance'), /unavailable or busy/);
let firstCalls = 0, secondCalls = 0;
let release: () => void = () => {};
const first = registry.register('Finance', async () => { firstCalls++; await new Promise<void>(resolve => { release = resolve; }); });
const second = registry.register('Finance', async () => { secondCalls++; });
assert.equal(registry.available('Finance'), true);
const a = registry.refresh('Finance'), b = registry.refresh('Finance');
assert.equal(a, b, 'overlapping gestures share one bounded batch');
await Promise.resolve(); release(); await a;
assert.equal(firstCalls, 1); assert.equal(secondCalls, 1);
second.update(async () => { secondCalls++; }, true);
assert.equal(registry.available('Finance'), false);
await assert.rejects(registry.refresh('Finance'), /busy/);
assert.equal(firstCalls, 1, 'a blocked reader prevents a partial refresh');
second.update(async () => { throw new Error('Synthetic read failed'); }, false);
first.update(async () => { firstCalls++; }, false);
await assert.rejects(registry.refresh('Finance'), /Synthetic read failed/);
assert.equal(firstCalls, 2, 'all enabled readers were attempted; errors propagate');
second.unregister(); first.unregister();
assert.equal(registry.available('Finance'), false);

let observed: AbortSignal | undefined;
const removed = registry.register('Krewe', async signal => { observed = signal; await new Promise<void>(() => {}); });
const gone = registry.refresh('Krewe'); await Promise.resolve(); removed.unregister();
await assert.rejects(gone, /reader was closed/);
assert.equal(observed?.aborted, true, 'unmount aborts pending subscriber');
// A scope change cleans up the old registration before registering the new date.
let nextScopeReads = 0;
const nextScope = registry.register('Krewe', async () => { nextScopeReads++; });
await registry.refresh('Krewe');
assert.equal(nextScopeReads, 1, 'new scope can refresh after the old scope aborted');
nextScope.unregister();
const locked = registry.register('Fleet', async signal => { observed = signal; await new Promise<void>(() => {}); });
const blocked = registry.refresh('Fleet'); await Promise.resolve(); locked.update(async () => {}, true);
await assert.rejects(blocked, /paused/);
assert.equal(observed?.aborted, true, 'editing interrupts a pending snapshot read');
locked.unregister();
const stalled = registry.register('Marketing', async signal => { observed = signal; await new Promise<void>(() => {}); });
// AbortSignal.timeout does not keep Node alive; hold a bounded test timer.
const keepAlive = setTimeout(() => {}, 100);
await assert.rejects(registry.refresh('Marketing'), error => error instanceof DOMException && error.name === 'TimeoutError');
clearTimeout(keepAlive); assert.equal(observed?.aborted, true); stalled.unregister();
let latest = '';
const changed = registry.register('Command', async () => { latest = 'old'; });
changed.update(async () => { latest = 'new'; }, false);
await registry.refresh('Command'); assert.equal(latest, 'new'); changed.unregister();
assert.ok(notifications > 0); unsubscribe();

for (const [file, key] of [['live-finance','Finance'],['live-marketing','Marketing'],['live-krewe','Krewe'],['live-fleet','Fleet']]) {
  const source = fs.readFileSync(`desktop-ui/${file}.tsx`, 'utf8');
  assert.match(source, new RegExp(`useRegisterDisplayedRefresh\\('${key}', freshness\\.refreshDisplayed,`));
  assert.match(source, /loadSnapshot\s*=\s*useCallback\(async\s*\(signal:\s*AbortSignal\)/);
  assert.match(source, /fetchWorkspace<[^>]+>\(snapshotKey,\s*signal\)/);
  const registration = source.split('\n').find(line => line.includes(`useRegisterDisplayedRefresh('${key}'`))!;
  assert.doesNotMatch(registration, /checkReceipt|checkSavedResult|mutate|save\(|verify/);
  assert.doesNotMatch(registration, /freshness\.pending/, 'reader must not abort itself when starting the shared flight');
  assert.match(registration, /, snapshotKey\);$/, 'date/view snapshot identity scopes registration');
}
const cache = fs.readFileSync('desktop-ui/lib/workspace-cache.ts', 'utf8');
assert.match(cache, /fetch\(url, \{ cache: 'no-store', credentials: 'same-origin', signal \}\)/);
for (const file of ['live-finance','live-marketing','live-krewe']) {
  const source = fs.readFileSync(`desktop-ui/${file}.tsx`, 'utf8');
  const key = source.split('\n').find(line => /const snapshotKey\s*=/.test(line))!;
  assert.doesNotMatch(key, /receipt|verify|refresh|collect|sync/);
}
console.log('Displayed refresh: explicit reader availability, all-reader busy gate, latest callback, overlap dedup, errors, timeout, unmount/edit abort, and snapshot-only integration passed. No source calls or writes.');

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
