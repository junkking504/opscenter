import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { continuitySnapshot } from '../lib/continuity-monitor';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-reader-'));
const file = path.join(root, 'monitor.json');
const now = Date.now();
const date = new Date(now).toISOString();
const healthy = () => ({ version: 1, checkedAt: date, checks: Array.from({ length: 10 }, (_, i) => ({ key: String(i), title: 'Check', status: 'ok', evidence: 'Observed', nextStep: 'Inspect' })), incidents: [] as Record<string, unknown>[] });
const read = (document: unknown) => { fs.writeFileSync(file, JSON.stringify(document)); return continuitySnapshot(now, file); };
try {
  assert.equal(continuitySnapshot(now, file).status, 'unknown');
  assert.equal(read(healthy()).status, 'ready');
  assert.equal(read({ bridgeStatus: 'success', receivedAt: date, remote: healthy() }).status, 'ready');
  for (const checkedAt of [new Date(now - 180001).toISOString(), new Date(now + 1).toISOString(), null, 'bad']) {
    assert.equal(read({ ...healthy(), checkedAt }).status, 'unknown');
  }
  assert.equal(read({ bridgeStatus: 'failed', receivedAt: date, remote: healthy() }).status, 'unknown');
  assert.equal(read({ bridgeStatus: 'success', receivedAt: new Date(now - 180001).toISOString(), remote: healthy() }).status, 'unknown');
  const recovery = healthy();
  recovery.incidents = [{ key: '0', status: 'open', firstSeenAt: date, lastSeenAt: date, resolvedAt: null, occurrences: 1 }];
  assert.equal(read(recovery).status, 'attention');
  recovery.incidents[0].status = 'resolved'; recovery.incidents[0].resolvedAt = date;
  assert.equal(read(recovery).status, 'ready');
  for (const invalid of [null, {}, { ...healthy(), checks: [] }, { ...healthy(), incidents: [null] }, { ...healthy(), checks: Array(10).fill(healthy().checks[0]) }]) {
    assert.equal(read(invalid).status, 'unknown');
  }
  fs.writeFileSync(file, '{'); assert.equal(continuitySnapshot(now, file).status, 'unknown');
  console.log('Continuity reader: freshness, bridge failures, malformed evidence and recovery confirmation passed.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
