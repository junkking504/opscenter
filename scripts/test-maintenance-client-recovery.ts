import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectMaintenance, initialMaintenanceState, reconcileMaintenance, readClientEvents, recordClientEvent } from '../lib/maintenance-monitor';
import { recordClientRecovery } from '../lib/maintenance-client-recovery';
import { requiredOpsPermission, opsRoleCan } from '../lib/ops-roles';

const now = Date.parse('2026-09-14T14:00:00Z');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-client-recovery-'));
try {
  const permission = requiredOpsPermission('/api/desktop/maintenance/verification', 'POST').permission;
  assert.equal(permission, 'platform.manage');
  assert.equal(opsRoleCan('operator', permission), false);
  assert.equal(opsRoleCan('manager', permission), false);
  assert.equal(opsRoleCan('admin', permission), true);
  const state = initialMaintenanceState();
  const observe = (at: number) => reconcileMaintenance(state, detectMaintenance({ login: true, health: {}, readiness: {}, clientEvents: readClientEvents(directory) }, at), at);
  recordClientEvent('schedule', directory, now);
  observe(now); observe(now + 60_000);
  const incident = state.incidents.find(row => row.key === 'client-schedule')!;
  assert.equal(incident.status, 'open');
  for (let i = 11; i < 15; i++) observe(now + i * 60_000);
  assert.equal(incident.status, 'open', 'Quiet or expired traffic is not a successful interaction');
  assert.equal(incident.unhealthy, null);
  assert.equal(incident.goodChecks, 0);
  assert.equal(recordClientRecovery('../escape', now, 'Verified source and drawer agree.', 'test-admin', directory, now + 900_000), false);
  assert.equal(recordClientRecovery('schedule', now - 1, 'Verified source and drawer agree.', 'test-admin', directory, now + 900_000), false, 'Stale failure generation rejected');
  assert.equal(recordClientRecovery('schedule', now, 'okay', 'test-admin', directory, now + 900_000), false);
  assert.equal(recordClientRecovery('command', now, 'Verified source and drawer agree.', 'test-admin', directory, now + 900_000), false, 'Unrelated category cannot clear Schedule');
  assert.equal(recordClientRecovery('schedule', now, 'Opened the appointment and verified source and drawer agree.', 'test-admin', directory, now + 900_000), true);
  for (let i = 16; i < 19; i++) observe(now + i * 60_000);
  assert.equal(incident.status, 'resolved');
  assert.ok(incident.recoveryVerifiedAt);

  // New errors invalidate proof even within the count-throttle interval.
  recordClientEvent('schedule', directory, now + 1200_000);
  const next = readClientEvents(directory).schedule.at;
  assert.equal(recordClientRecovery('schedule', next, 'Verified the same interaction after this new failure.', 'test-admin', directory, next + 1), true);
  recordClientEvent('schedule', directory, next + 2);
  observe(next + 60_000); observe(next + 120_000);
  assert.equal(incident.status, 'open');
  assert.equal(incident.recoveryVerifiedAt, undefined);
  assert.equal(readClientEvents(directory).schedule.count, 1, 'Count throttling remains separate from latest failure identity');
  fs.writeFileSync(path.join(directory, 'verified-schedule.json'), '{broken');
  observe(next + 900_000);
  assert.equal(incident.status, 'open', 'Corrupt proof fails closed');

  const budget = JSON.stringify(state.months);
  incident.status = 'resolved'; incident.resolvedAt = new Date(next).toISOString(); incident.attempts = 3;
  observe(next + 960_000);
  assert.equal(incident.status, 'open', 'Historical silence-based closure is returned to review');
  assert.equal(incident.attempts, 3, 'Recovery does not reset diagnosis allowance');
  assert.equal(JSON.stringify(state.months), budget, 'Incident reconciliation never resets budget history');
  recordClientEvent('schedule', directory, next + 2000_000);
  const future = { ...readClientEvents(directory), schedule: { at: next + 2000_000, count: 1, recovery: { failureAt: next + 2000_000, verifiedAt: next + 3000_000, evidence: 'Verified future proof is rejected.', actor: 'test-admin' } } };
  assert.notEqual(detectMaintenance({ login: true, health: {}, readiness: {}, clientEvents: future }, next + 2000_001).find(row => row.key === 'client-schedule')?.unhealthy, false);
  console.log('Browser incident recovery: silence, exact failure proof, new error invalidation, corrupt/future proof, roles and retained budget passed.');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
