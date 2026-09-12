import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DesktopAppointment } from '../lib/desktop-schedule';
import { closeoutSourceVersion } from '../lib/desktop-closeout-contract';

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-desktop-operations-test-'));
  process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR = path.join(temporary, 'receipts');
  process.env.JOB_ROUTE_ASSIGNMENTS_FILE = path.join(temporary, 'assignments.json');
  const { executeScheduleOperation, parseScheduleOperation, readScheduleReceipt, reconcileCloseoutReceipt } = await import('../lib/desktop-schedule-operations');
  const { authorizeOpsRequest } = await import('../lib/ops-roles');
  const date = '2026-09-03';
  const job = { appointmentId: '1234', recordId: `${date}:appointment:1234`, version: 'a'.repeat(64), appointmentType: 'Estimate', status: 'Confirmed' } as DesktopAppointment;
  const operation = (patch: Record<string, unknown> = {}) => parseScheduleOperation({ requestId: randomUUID(), date, recordId: job.recordId, expectedVersion: job.version, action: 'move', values: { truck: 'Truck 12', appointmentStartMinutes: 600, durationHours: 1 }, ...patch });
  let writes = 0;
  const success = async () => { writes++; return { status: 200, body: { ok: true, junkwareSynced: true } }; };
  try {
    assert.throws(() => operation({ date: '2026-02-30' }), /required/);
    assert.throws(() => operation({ recordId: `${date}:appointment:../x` }), /required/);
    assert.throws(() => operation({ values: { truck: 'Truck 12', appointmentStartMinutes: 610, durationHours: 1 } }), /required/);
    assert.throws(() => operation({ values: { truck: 'Truck 12', appointmentStartMinutes: 1380, durationHours: 2 } }), /required/);
    assert.throws(() => operation({ values: { truck: 'Truck 0' } }), /required/);
    assert.throws(() => operation({ action: 'call_ahead', values: {} }), /required/);
    assert.throws(() => operation({ action: 'note', values: { note: ' ' } }), /required/);
    assert.equal(authorizeOpsRequest('operator', '/api/job-cancellation', 'POST').allowed, false);
    assert.equal(authorizeOpsRequest('admin', '/api/job-cancellation', 'POST').allowed, true);
    const verifiedOperation = operation();
    const receipts = await Promise.all([1, 2].map(() => executeScheduleOperation(verifiedOperation, 'test-operator', () => job, success)));
    assert.equal(writes, 1, 'Concurrent duplicate requests must write once');
    assert.ok(receipts.every(receipt => receipt.status === 'verified'));
    assert.equal((await readScheduleReceipt(verifiedOperation.requestId))?.status, 'verified');
    await assert.rejects(executeScheduleOperation(verifiedOperation, 'another-operator', () => job, success), /different change/);
    await assert.rejects(executeScheduleOperation({ ...verifiedOperation, values: { truck: 'Truck 2' } }, 'test-operator', () => job, success), /different change/);
    await assert.rejects(executeScheduleOperation(operation(), 'test-operator', () => ({ ...job, version: 'b'.repeat(64) }), success), /changed/);
    await assert.rejects(executeScheduleOperation(operation({ action: 'cancel', values: { reason: 'Synthetic cancellation' } }), 'test-operator', () => ({ ...job, status: 'Closed' }), success), /Closed/);
    await assert.rejects(executeScheduleOperation(operation({ action: 'closeout', values: { expectedSourceVersion: 'a'.repeat(64) } }), 'test-operator', () => ({ ...job, status: 'Canceled' }), success), /Canceled/);
    await assert.rejects(executeScheduleOperation(operation(), 'test-operator', () => ({ ...job, junkwareSyncStatus: 'pending' }), success), /unverified change/);
    await assert.rejects(executeScheduleOperation(operation(), 'test-operator', () => ({ ...job, junkwareSyncStatus: 'manual_correction' }), success), /unverified change/);
    const rejected = await executeScheduleOperation(operation(), 'test-operator', () => job, async () => ({ status: 400, body: { ok: false, error: 'Rejected before source write' } }));
    assert.equal(rejected.status, 'failed');
    const unknownOperation = operation();
    const unknown = await executeScheduleOperation(unknownOperation, 'test-operator', () => job, async () => { writes++; return { status: 202, body: { ok: true, junkwareSynced: false } }; });
    assert.equal(unknown.status, 'uncertain', 'Persisted locally is not verified in JunkWare');
    await executeScheduleOperation(unknownOperation, 'test-operator', () => job, success);
    assert.equal(writes, 2, 'An uncertain request must never be replayed');
    await assert.rejects(executeScheduleOperation(operation(), 'another-operator', () => job, success), /unverified change/);
    await assert.rejects(executeScheduleOperation(operation({ date: '2026-09-04', recordId: '2026-09-04:appointment:1234' }), 'test-operator', () => job, success), /unverified change/);
    assert.equal(writes, 2, 'New request IDs, dates and operators cannot bypass an uncertain write');
    const other = { ...job, appointmentId: '5678', recordId: `${date}:appointment:5678` };
    const thrown = await executeScheduleOperation(operation({ recordId: other.recordId }), 'test-operator', () => other, async () => { throw new Error('Transport disconnected after submit'); });
    assert.equal(thrown.status, 'uncertain');
    const abandonedOperation = operation({ recordId: `${date}:appointment:9012` });
    const abandoned = { ...receipts[0], requestId: abandonedOperation.requestId, recordId: abandonedOperation.recordId, status: 'pending', updatedAt: new Date(Date.now() - 11 * 60_000).toISOString() };
    const abandonedPath = path.join(temporary, 'receipts', `${abandoned.requestId}.json`);
    await fs.writeFile(abandonedPath, JSON.stringify(abandoned));
    assert.equal((await readScheduleReceipt(abandoned.requestId))?.status, 'uncertain', 'Abandoned writes must not appear to run indefinitely');
    assert.equal(JSON.parse(await fs.readFile(abandonedPath, 'utf8')).status, 'pending', 'Read-back must preserve the original audit record');
    const writesBefore = writes;
    await assert.rejects(executeScheduleOperation(operation({ recordId: abandoned.recordId }), 'test-operator', () => ({ ...job, recordId: abandoned.recordId }), success), /unverified change/);
    assert.equal(writes, writesBefore, 'Stale pending writes remain blocked against duplicate submission');
    await fs.writeFile(abandonedPath, JSON.stringify({ ...abandoned, updatedAt: new Date().toISOString() }));
    assert.equal((await readScheduleReceipt(abandoned.requestId))?.status, 'pending', 'An active request keeps its pending status');
    const persisted = await fs.readFile(path.join(temporary, 'receipts', `${verifiedOperation.requestId}.json`), 'utf8');
    assert.equal(persisted.includes('appointmentStartMinutes'), false, 'Do not store customer input in receipts');
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const slowJob = { ...job, appointmentId: '3333', recordId: `${date}:appointment:3333` };
    const fastJob = { ...job, appointmentId: '4444', recordId: `${date}:appointment:4444` };
    const slow = executeScheduleOperation(operation({ recordId: slowJob.recordId }), 'test-operator', () => slowJob, async () => { started(); await gate; return {status:200,body:{ok:true}}; });
    await entered;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const fast = await Promise.race([
        executeScheduleOperation(operation({ recordId: fastJob.recordId }), 'test-operator', () => fastJob, async () => ({status:200,body:{ok:true}})),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Unrelated appointment blocked by slow closeout')), 2000); }),
      ]);
      assert.equal(fast.status, 'verified');
    } finally { clearTimeout(timer); release(); await slow; }
    const baseline = { status: { value: '1' }, payments: [], otherCharges: [] };
    const recoveryJob = { ...job, appointmentId: '5555', recordId: `${date}:appointment:5555` };
    const recoveryOperation = operation({ action: 'closeout', recordId: recoveryJob.recordId, values: { expectedSourceVersion: closeoutSourceVersion(baseline) } });
    await executeScheduleOperation(recoveryOperation, 'test-operator', () => recoveryJob, async () => { throw new Error('Lost response'); });
    assert.equal(await reconcileCloseoutReceipt(recoveryOperation.requestId, 'other-actor', async () => { throw new Error('Must not read'); }), null);
    assert.equal((await reconcileCloseoutReceipt(recoveryOperation.requestId, 'test-operator', async () => { throw new Error('Source down'); }))?.status, 'uncertain');
    assert.equal((await reconcileCloseoutReceipt(recoveryOperation.requestId, 'test-operator', async () => ({ ...baseline, payments: [100] })))?.status, 'uncertain', 'Partial save stays protected');
    const reconciled = await reconcileCloseoutReceipt(recoveryOperation.requestId, 'test-operator', async () => baseline);
    assert.equal(reconciled?.status, 'failed');
    assert.equal(reconciled?.priorResult?.status, 'uncertain', 'Keep original result for audit');
    assert.equal((await readScheduleReceipt(recoveryOperation.requestId))?.status, 'failed');
    console.log('Schedule operations passed: input validation, roles, source versions, durable read-back, concurrent idempotency, separate estimate identity, closed-record safety, and unknown-result retry guard. No live writes performed.');
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
void main();
