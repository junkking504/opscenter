import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

async function main() {
  const database = new URL(process.env.OPSCENTER_PREVIEW_DATABASE_URL || '');
  assert.equal(database.pathname, '/opscenter_control_preview_test', 'Only the disposable test database is allowed.');
  assert.match(database.searchParams.get('host') || '', /^\/tmp\/ops-control-preview-test\.[a-zA-Z0-9]+\/socket$/);
  assert.equal(process.env.OPSCENTER_RUNTIME, 'MAC_MINI_PREVIEW');
  assert.match(process.cwd(), /^\/(?:private\/)?tmp\/ops-control-preview-test\.[a-zA-Z0-9]+\/workspace$/);
  const { getKernelPool } = await import('../lib/platform/persistence/pool');
  const { ensureHumanOperator } = await import('../lib/platform/persistence/actors');
  const { createManualWorkItem, getWorkItem, reconcileDetectedWorkItem } = await import('../lib/platform/persistence/work-items');
  const { executeDesktopControl, readDesktopControl } = await import('../lib/desktop-control');
  const pool = getKernelPool();
  await pool.query(fs.readFileSync(path.join(process.cwd(), 'lib/platform/persistence/migrations/0001_kernel.sql'), 'utf8'));
  const identity = { email: 'synthetic-control@example.invalid', role: 'manager' as const };
  const operator = { email: 'synthetic-operator@example.invalid', role: 'operator' as const };
  const actor = await ensureHumanOperator(identity.email);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const dueAt = new Date(Date.now() + 86400000).toISOString();
  const item = await createManualWorkItem({ operatingDate: date, title: 'Synthetic review task', description: 'Synthetic isolated database test only.', category: 'Jobs', severity: 'warning', relatedRecord: 'synthetic-appointment', dueAt, assignToSelf: true }, { actorId: actor.id, correlationId: randomUUID() });
  const handoff = { date, requestId: randomUUID(), action: 'handoff', expectedVersion: item.version, itemId: item.id, status: 'in_progress', reason: 'Synthetic source review before dispatch.', dueAt, assignToSelf: true };
  const results = await Promise.all([executeDesktopControl(handoff, identity), executeDesktopControl(handoff, identity)]);
  assert.deepEqual(results[0], results[1], 'Concurrent identical requests return the same committed receipt.');
  assert.equal((await getWorkItem(item.id))?.version, 2, 'Concurrent duplicate requests must mutate once.');
  assert.equal((await getWorkItem(item.id))?.status, 'in_progress');
  await assert.rejects(executeDesktopControl({ ...handoff, reason: 'Changed request body must not reuse its ID.' }, identity), /different action/);
  await assert.rejects(executeDesktopControl({ ...handoff, requestId: randomUUID() }, identity), /changed/);
  const resolved = await executeDesktopControl({ ...handoff, requestId: randomUUID(), expectedVersion: 2, action: 'resolve_manually' }, identity);
  assert.match(String(resolved.summary), /does not verify an external source/);
  assert.equal((await getWorkItem(item.id))?.resolutionCode, 'manual_resolution');
  await assert.rejects(executeDesktopControl({ ...handoff, requestId: randomUUID(), expectedVersion: 3 }, identity), /transition/);
  const rollback = await pool.query('SELECT count(*)::int AS count FROM opscenter_kernel.action_runs WHERE work_item_id=$1', [item.id]);
  assert.equal(rollback.rows[0].count, 2, 'Rejected transitions must roll back without a success receipt.');
  await executeDesktopControl({ ...handoff, requestId: randomUUID(), expectedVersion: 3, action: 'reopen' }, identity);
  assert.equal((await getWorkItem(item.id))?.status, 'open');
  const finance = await createManualWorkItem({ operatingDate: date, title: 'Synthetic finance task', description: 'Synthetic sensitive work.', category: 'Finance', severity: 'warning', relatedRecord: 'synthetic-finance', dueAt, assignToSelf: true }, { actorId: actor.id, correlationId: randomUUID() });
  await assert.rejects(executeDesktopControl({ ...handoff, requestId: randomUUID(), expectedVersion: 1, itemId: finance.id }, operator), /Your role/);
  await assert.rejects(executeDesktopControl({ date, requestId: randomUUID(), action: 'close_day', expectedVersion: 0 }, operator), /Your role/);
  // More than two hundred real SQL rows exercise the page boundary without
  // truncating readiness ownership to the visible page.
  await pool.query(`INSERT INTO opscenter_kernel.work_items (id,dedupe_key,operating_date,rule,category,severity,entity_type,entity_id,title,description,source,source_observed_at,status,first_detected_at,last_detected_at) SELECT 'synthetic-page-'||n,'synthetic-dedupe-'||n,$1,'manual_follow_up.synthetic','Jobs','info','job','synthetic-'||n,'Synthetic page '||n,'Isolated test only','Manual entry',now(),'open',now(),now() FROM generate_series(1,205) n`, [date]);
  const firstPage = await readDesktopControl(date, identity, 1);
  const thirdPage = await readDesktopControl(date, identity, 3);
  assert.equal(firstPage.items.length, 100);
  assert.equal(thirdPage.pagination.total, 207);
  assert.equal(thirdPage.items.length, 7);
  assert.equal(new Set([...firstPage.items, ...thirdPage.items].map(item => item.id)).size, 107);
  const linked = await readDesktopControl(date, identity, 1, thirdPage.items[0].id);
  assert.equal(linked.pagination.page, 3, 'A deep link must load the actual page beyond 200 work items.');
  assert.ok(linked.items.some(item => item.id === thirdPage.items[0].id));
  await assert.rejects(readDesktopControl(date, operator, 1, finance.id), /unavailable/);
  await assert.rejects(readDesktopControl(date, identity, 1, 'missing-synthetic-id'), /unavailable/);
  const restricted = await readDesktopControl(date, operator);
  assert.equal(restricted.items.some(item => item.category === 'Finance'), false);
  assert.equal(restricted.pagination.total, 206);
  await assert.rejects(executeDesktopControl({ date, requestId: randomUUID(), action: 'start_day', expectedVersion: 0 }, identity), /readiness gate/);
  for (const phase of ['start', 'close'] as const) {
    const snapshot = await readDesktopControl(date, identity);
    for (const gate of snapshot.gates[phase]) {
      if (gate.count === 0 || gate.workItemId) continue;
      await executeDesktopControl({ date, requestId: randomUUID(), action: 'own_gate', expectedVersion: snapshot.day.version, gateId: gate.id, evidenceVersion: gate.evidenceVersion, dueAt, reason: 'Synthetic unknown-source handoff for lifecycle validation.' }, identity);
    }
    const before = await readDesktopControl(date, identity);
    assert.ok(before.gates[phase].every(gate => gate.count === 0 || gate.workItemId), 'Gate ownership must include work outside the visible page.');
    const action = phase === 'start' ? 'start_day' : 'close_day';
    const receipt = await executeDesktopControl({ date, requestId: randomUUID(), action, expectedVersion: before.day.version }, identity);
    assert.equal((receipt.evidence as { status: string }).status, phase === 'start' ? 'operating' : 'closed');
  }
  const closed = await readDesktopControl(date, identity);
  assert.equal(closed.day.status, 'closed');
  await assert.rejects(executeDesktopControl({ date, requestId: randomUUID(), action: 'reopen_day', expectedVersion: 0, reason: 'Synthetic stale-version transition.' }, identity), /changed/);
  await executeDesktopControl({ date, requestId: randomUUID(), action: 'reopen_day', expectedVersion: closed.day.version, reason: 'Synthetic reopening after verified test closure.' }, identity);
  assert.equal((await readDesktopControl(date, identity)).day.status, 'operating');
  const audit = await pool.query('SELECT count(*)::int AS count FROM opscenter_kernel.events WHERE actor_id=$1', [actor.id]);
  assert.ok(audit.rows[0].count >= 10);
  const { reconcileOperatingInbox } = await import('../lib/platform/inbox');
  const metricsDirectory = path.join(process.cwd(), 'data/history/daily_metrics');
  fs.mkdirSync(metricsDirectory, { recursive: true });
  const observation = new Date().toISOString();
  const writeObservation = (generated_at: string) => fs.writeFileSync(path.join(metricsDirectory, `daily_metrics_${date}.json`), JSON.stringify({ date, generated_at, appointments: [], employee_leaderboard: [], attendance_employee_metrics: [], missing_inputs: [] }));
  writeObservation(observation);
  const detected = await reconcileDetectedWorkItem({ operatingDate: date, rule: 'payment_amount_present_but_payment_type_missing', category: 'Jobs', severity: 'warning', entity: { type: 'job', id: 'synthetic-missing-payment' }, title: 'Synthetic missing payment method', description: 'Synthetic source detector test.', source: 'Synthetic fixture', sourceObservedAt: observation }, { actorId: actor.id, correlationId: randomUUID() });
  await reconcileOperatingInbox(date, actor.id);
  assert.equal((await getWorkItem(detected.workItem.id))?.status, 'open', 'One fresh absence cannot resolve a source condition.');
  await reconcileOperatingInbox(date, actor.id);
  assert.equal((await getWorkItem(detected.workItem.id))?.status, 'open', 'Repeated identical snapshots cannot manufacture verification.');
  writeObservation(new Date(Date.parse(observation)+1000).toISOString());
  await reconcileOperatingInbox(date, actor.id);
  assert.equal((await getWorkItem(detected.workItem.id))?.resolutionCode, 'source_condition_cleared', 'Two distinct fresh observations can resolve the supported source condition.');
  console.log('Isolated PostgreSQL lifecycle passed: concurrent exactly-once handoff, JSONB-stable receipts, conflict rollback, manual-resolution labeling, role isolation, 207-row pagination, off-page gate ownership, day start/close/reopen, stale-version rejection, attributable events, and source resolution requiring two distinct fresh observations. No production database or source writes.');
  await pool.end();
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Isolated database test failed.'); process.exitCode = 1; });
