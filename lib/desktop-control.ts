import { desktopWorkItemHref } from '@/lib/desktop-record-links';
import { readDesktopSourceHealth } from '@/lib/desktop-source-health';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { readDesktopSchedule } from '@/lib/desktop-schedule';
import { readDesktopCommand } from '@/lib/desktop-command';
import { getDataHealthReport } from '@/lib/data-health';
import { buildOperationalExceptions } from '@/lib/operational-exceptions';
import { buildDailyPaymentReconciliation } from '@/lib/payment-reconciliation';
import { readFleetChecklistStore, fleetChecklistStorePath } from '@/lib/fleet-checklists';
import { readFleetIssueStore } from '@/lib/fleet-issues';
import { readMetrics } from '@/lib/opsData';
import { inboxRulePolicy } from '@/lib/platform/work-policy';
import { getKernelPool } from '@/lib/platform/persistence/pool';
import { withKernelTransaction } from '@/lib/platform/persistence/transaction';
import { appendPlatformEvent } from '@/lib/platform/persistence/events';
import { ensureHumanOperator, actorDisplayNames } from '@/lib/platform/persistence/actors';
import { assertWorkItemTransition } from '@/lib/platform/state-machines';
import { createCorrelationId, createPlatformId } from '@/lib/platform/identifiers';
import { redactOperationalValue } from '@/lib/platform/redaction';
import { opsRoleCan, type InteractiveOpsRole } from '@/lib/ops-roles';
import type { WorkItemStatus } from '@/lib/platform/contracts';
import { canonicalControlInput, controlGateCleared, parseControlRequest, validControlDate, type ControlAction, type ControlGate, type ControlItem, type ControlRequest, type ControlSnapshot } from '../desktop-ui/lib/control-contract';
import { appointmentCategory, isClosed, truckLabel } from '../desktop-ui/lib/schedule-contract';

type Identity = { email: string; role: InteractiveOpsRole };
const hash = (value: unknown) => createHash('sha256').update(canonicalControlInput(value)).digest('hex');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const sourceHref = (date: string, workspace: string) => `/desktop?data=live&date=${encodeURIComponent(date)}&workspace=${workspace}`;
const finite = (value: unknown): number | null => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export function controlReconciliationReady(date: string, metrics: Record<string, unknown> | null, now = new Date()): boolean {
  if (!metrics || !Array.isArray(metrics.appointments) || !(Array.isArray(metrics.employee_leaderboard) || Array.isArray(metrics.attendance_employee_metrics))) return false;
  const missing = metrics.missing_inputs;
  if (Array.isArray(missing) ? missing.length > 0 : missing && typeof missing === 'object' ? Object.keys(missing).length > 0 : Boolean(missing)) return false;
  const observed = new Date(String(metrics.generated_at || ''));
  if (!Number.isFinite(observed.getTime())) return false;
  const chicagoDate = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(value);
  if (date !== chicagoDate(now)) return chicagoDate(observed) === date;
  const age = now.getTime()-observed.getTime();
  return age >= -10*60000 && age <= 6*60*60000;
}

// One registry and executor owns every desktop Control write. All effects are
// OpsCenter-owned SQL state, and all effects, receipts and audit events commit in
// one transaction. There are no external writes or simulated provider verifiers.
export const CONTROL_ACTION_DEFINITIONS = Object.freeze(Object.fromEntries(
  (['handoff', 'acknowledge', 'resolve_manually', 'dismiss', 'reopen', 'own_gate', 'start_day', 'close_day', 'reopen_day'] as ControlAction[]).map(action => [action, {
    key: `control.${action}.v1`, version: 1, riskClass: 1,
    permission: action === 'close_day' || action === 'reopen_day' ? 'sensitive.write' : 'operations.write',
    authority: 'opscenter_authoritative',
    verifier: 'Read back the exact work-item version or operating-day event in the committing transaction.',
    recovery: 'Refresh Control after an uncertain response. Repeat only the identical request ID and input; committed receipts return without repeating effects.',
  }]),
)) as Readonly<Record<ControlAction, { key: string; version: number; riskClass: number; permission: 'sensitive.write' | 'operations.write'; authority: string; verifier: string; recovery: string }>>;

async function readDay(client: Pick<PoolClient, 'query'>, date: string): Promise<ControlSnapshot['day']> {
  const result = await client.query<{ payload_json: { status: ControlSnapshot['day']['status']; version: number }; occurred_at: Date }>(
    `SELECT payload_json, occurred_at FROM opscenter_kernel.events WHERE aggregate_type = 'operating_day' AND aggregate_id = $1 AND event_type = 'control.day_changed.v1' ORDER BY (payload_json->>'version')::integer DESC LIMIT 1`, [date]);
  return result.rows[0] ? { status: result.rows[0].payload_json.status, version: result.rows[0].payload_json.version, updatedAt: new Date(result.rows[0].occurred_at).toISOString() } : { status: 'planning', version: 0, updatedAt: null };
}

export async function readDesktopControl(dateInput: string, identity: Identity, page = 1, focusItemId?: string): Promise<ControlSnapshot> {
  const date = validControlDate(dateInput);
  if (!opsRoleCan(identity.role, 'operations.read')) throw new Error('Your role does not include Control.');
  const actor = await ensureHumanOperator(identity.email);
  const canFinance = opsRoleCan(identity.role, 'finance.read');
  if (focusItemId) {
    if (focusItemId.length > 120) throw new Error('A valid work item is required.');
    const position = await getKernelPool().query<{ page: string }>(`SELECT ceil(position / 100.0)::text AS page FROM (SELECT id,row_number() OVER (ORDER BY CASE WHEN status IN ('resolved','dismissed') THEN 1 ELSE 0 END,CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,due_at NULLS LAST,id) AS position FROM opscenter_kernel.work_items WHERE (operating_date=$1 OR (operating_date<$1 AND status NOT IN ('resolved','dismissed'))) AND ($2 OR category <> 'Finance')) ranked WHERE id=$3`, [date,canFinance,focusItemId]);
    if (!position.rows[0]) throw new Error('The linked work item is unavailable for your role or outside the selected operating day.');
    page = Number(position.rows[0].page);
  }
  const schedule = readDesktopSchedule(date);
  const metrics = readMetrics(date);
  const exceptions = buildOperationalExceptions(date);
  const health = getDataHealthReport(); // Explicitly current source health, even for a historical operating day.
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new Error('A valid queue page is required.');
  const [itemRows, allActiveRows, command, day, countResult, audits, actions, actionRows] = await Promise.all([
    getKernelPool().query<{ item: ControlItem; rule: string }>(`SELECT rule,jsonb_build_object('id',id,'version',version,'operatingDate',operating_date,'category',category,'severity',severity,'title',title,'description',description,'source',source,'sourceObservedAt',source_observed_at,'status',status,'entity',jsonb_build_object('type',entity_type,'id',entity_id,'label',entity_label),'ownerActorId',owner_actor_id,'dueAt',due_at,'resolutionCode',resolution_code,'resolutionNote',resolution_note,'overdue',due_at <= now() AND status NOT IN ('resolved','dismissed'),'carryover',operating_date < $1 AND status NOT IN ('resolved','dismissed')) AS item FROM opscenter_kernel.work_items WHERE (operating_date=$1 OR (operating_date<$1 AND status NOT IN ('resolved','dismissed'))) AND ($2 OR category <> 'Finance') ORDER BY CASE WHEN status IN ('resolved','dismissed') THEN 1 ELSE 0 END,CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,due_at NULLS LAST,id LIMIT 100 OFFSET $3`, [date,canFinance,(page-1)*100]),
    getKernelPool().query<{ id: string; version: number; entity_id: string; owner_actor_id: string | null; due_at: Date | null; operating_date: string; status: ControlItem['status'] }>(`SELECT id,version,entity_id,owner_actor_id,due_at,operating_date::text,status FROM opscenter_kernel.work_items WHERE operating_date <= $1 AND status NOT IN ('resolved','dismissed') AND ($2 OR category <> 'Finance') ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,due_at NULLS LAST,id`, [date,canFinance]),
    readDesktopCommand(date, { displayName: actor.displayName, role: identity.role }),
    readDay(getKernelPool(), date),
    getKernelPool().query<{ count: string }>(`SELECT count(*) FROM opscenter_kernel.work_items WHERE (operating_date = $1 OR (operating_date < $1 AND status NOT IN ('resolved','dismissed'))) AND ($2 OR category <> 'Finance')`, [date,canFinance]),
    getKernelPool().query<{ id: string; event_type: string; aggregate_id: string; actor_id: string; occurred_at: Date; payload_json: Record<string, unknown> }>(
      `SELECT e.id,e.event_type,e.aggregate_id,e.actor_id,e.occurred_at,e.payload_json FROM opscenter_kernel.events e LEFT JOIN opscenter_kernel.work_items w ON e.aggregate_type = 'work_item' AND e.aggregate_id = w.id WHERE ((e.aggregate_type = 'operating_day' AND e.aggregate_id = $1) OR (w.operating_date = $1::date AND ($2 OR w.category <> 'Finance'))) ORDER BY e.recorded_at DESC,e.id DESC LIMIT 100`, [date, canFinance]),
    getKernelPool().query<{ status: string; count: string }>(`SELECT status,count(*) FROM opscenter_kernel.action_runs WHERE (requested_at AT TIME ZONE 'America/Chicago')::date = $1 AND ($2 OR actor_id = $3) GROUP BY status`, [date, canFinance, actor.id]),
    getKernelPool().query<{ id: string; action_key: string; entity_type: string; status: string; requested_at: Date }>(`SELECT id,action_key,entity_type,status,requested_at FROM opscenter_kernel.action_runs WHERE (requested_at AT TIME ZONE 'America/Chicago')::date=$1 AND status IN ('awaiting_approval','verifying','failed') AND ($2 OR actor_id=$3) ORDER BY requested_at DESC LIMIT 200`, [date,canFinance,actor.id]),
  ]);
  const owners = await actorDisplayNames([...itemRows.rows.map(row => row.item.ownerActorId || ''), ...allActiveRows.rows.map(row => row.owner_actor_id || '')]);
  const items = itemRows.rows.map(({item,rule}) => ({ ...item, ownerDisplayName: item.ownerActorId ? owners.get(item.ownerActorId) : undefined, recommendedAction: inboxRulePolicy(rule).recommendedAction, href: desktopWorkItemHref(item) }));
  const itemsTruncated = false;
  const allActive = allActiveRows.rows;
  const scheduleKnown = Boolean(schedule.observedAt);
  const appointments = schedule.appointments;
  const open = appointments.filter(job => !isClosed(job));
  const assigned = new Set(open.map(job => truckLabel(job.truck)).filter(truck => truck !== 'Unassigned'));
  const checklists = readFleetChecklistStore();
  const fleetIssues = readFleetIssueStore();
  const fleetStoreKnown = fs.existsSync(fleetChecklistStorePath()) && fs.existsSync(path.join(process.cwd(), 'data', 'fleet', 'repair_issues.json'));
  const fleetGaps = [...assigned].filter(truck => !checklists.entries.some(entry => truckLabel(entry.truck) === truck && entry.inspectionDate === date && entry.cadence === 'daily' && Boolean(entry.completedAt)) || fleetIssues.issues.some(issue => truckLabel(issue.truck) === truck && issue.status !== 'resolved' && issue.severity === 'out_of_service'));
  const finance = canFinance ? buildDailyPaymentReconciliation(date) : null;
  const sourceReady = scheduleKnown && (date !== today() || health.sources.junkware.status === 'green');
  const names = await actorDisplayNames(audits.rows.map(event => event.actor_id).filter(Boolean));
  const makeGate = (id: string, title: string, count: number | null, unit: string, detail: string, source: string, category: ControlGate['category'], workspace: string, evidence: unknown): ControlGate => {
    const evidenceVersion = hash({ id, date, count, evidence });
    const reference = `gate:${date}:${id}:${evidenceVersion}`;
    const owned = allActive.find(item => item.entity_id === reference && item.owner_actor_id && item.due_at && new Date(item.due_at).getTime() > Date.now());
    return { id, title, count, unit, detail, source, category, href: sourceHref(date, workspace), evidenceVersion, ownedBy: owned?.owner_actor_id ? owners.get(owned.owner_actor_id) : undefined, workItemId: owned?.id, workItemPage: owned ? Math.floor(allActive.indexOf(owned)/100)+1 : undefined };
  };
  const gateEvidence = appointments.map(job => [job.recordId, job.version]);
  const start: ControlGate[] = [
    makeGate('start:schedule', 'Schedule Plan', sourceReady ? open.filter(job => truckLabel(job.truck) === 'Unassigned' || !job.hasScheduledTime).length : null, 'gaps', sourceReady ? 'Unassigned appointments and missing time windows require a plan.' : 'Current schedule evidence is unavailable or stale.', 'JunkWare Schedule', 'Jobs', 'Schedule', gateEvidence),
    makeGate('start:fleet', 'Fleet Readiness', sourceReady && fleetStoreKnown ? fleetGaps.length : null, 'trucks', 'Scheduled trucks require a recorded daily inspection and no open out-of-service issue.', 'Fleet inspections + repair issues', 'Fleet', 'Fleet', [fleetGaps, checklists.updatedAt, fleetIssues.updatedAt]),
    makeGate('start:krewe', 'Krewe Coverage', sourceReady && metrics ? exceptions.counts.category.Crew : null, 'exceptions', 'Attendance and payroll exceptions retain their source evidence.', 'JunkWare Attendance', 'Crew', 'Krewe', exceptions.exceptions.filter(item => item.category === 'Crew').map(item => [item.id, item.reason])),
    makeGate('start:carryovers', 'Prior Carryovers', allActive.filter(item => item.operating_date < date && (!item.owner_actor_id || !item.due_at || new Date(item.due_at).getTime() <= Date.now())).length, 'items', 'Prior-day work requires an owner and a future deadline.', 'OpsCenter Control', 'Jobs', 'Command', allActive.filter(item => item.operating_date < date).map(item => [item.id, item.version])),
    makeGate('start:alerts', 'Critical Alerts', command.sources.alerts ? command.alerts.filter(alert => alert.priority === 'critical' && alert.workflowState === 'active').length : null, 'alerts', 'Critical source alerts require acknowledgement or owned work.', 'Slack + OpsCenter Control', 'Jobs', 'Command', command.alerts.filter(alert => alert.priority === 'critical').map(alert => [alert.id, alert.version])),
  ];
  const close: ControlGate[] = [
    makeGate('close:appointments', 'Appointment Disposition', sourceReady ? open.length : null, 'open', 'Each source appointment needs a final disposition or an owned carryover.', 'JunkWare Schedule', 'Jobs', 'Schedule', gateEvidence),
    makeGate('close:jobs', 'Job Closeouts', sourceReady && finance?.merchantCenterFresh ? exceptions.exceptions.filter(item => item.category === 'Jobs').length + finance.summary.exception_count : null, 'exceptions', canFinance ? 'Job audits and current card reconciliation must be reviewed.' : 'A manager must review financial closeout evidence.', 'JunkWare + QBO', 'Finance', 'Finance', [exceptions.exceptions.filter(item => item.category === 'Jobs').map(item => [item.id, item.reason]), finance?.generatedAt, finance?.summary.exception_count]),
    makeGate('close:estimates', 'Estimate Outcomes', sourceReady ? open.filter(job => appointmentCategory(job) === 'Estimate').length : null, 'open', 'Estimate outcomes remain separate from completed-job revenue.', 'JunkWare Schedule', 'Jobs', 'Schedule', gateEvidence.filter((_, index) => appointmentCategory(appointments[index]) === 'Estimate')),
    makeGate('close:fleet', 'Fleet End-of-Route', null, 'trucks', 'The load ledger has no authoritative route-finished flag. Review the final loads and record an owned handoff.', 'Fleet Load Ledger', 'Fleet', 'Fleet', [...assigned]),
    makeGate('close:handoffs', 'Krewe and Handoffs', sourceReady && metrics ? exceptions.counts.category.Crew + allActive.filter(item => !item.entity_id.startsWith('gate:')).length : null, 'items', 'Open attendance exceptions and operating decisions require accountable follow-through.', 'JunkWare Attendance + OpsCenter Control', 'Crew', 'Krewe', [exceptions.exceptions.filter(item => item.category === 'Crew').map(item => [item.id, item.reason]), allActive.filter(item => !item.entity_id.startsWith('gate:')).map(item => [item.id, item.version])]),
  ];
  const routeTrucks = [...new Set(appointments.map(job => truckLabel(job.truck)).filter(truck => truck !== 'Unassigned'))];
  const actionCount = (status: string) => Number(actions.rows.find(row => row.status === status)?.count || 0);
  return {
    date, generatedAt: new Date().toISOString(), actor: { id: actor.id, displayName: actor.displayName, canWrite: opsRoleCan(identity.role, 'operations.write'), canCloseDay: opsRoleCan(identity.role, 'sensitive.write') },
    items, itemLimit: 100, itemsTruncated, scheduleAvailable: sourceReady, gates: { start, close }, day,
    pagination: { page, pageSize: 100, total: Number(countResult.rows[0]?.count || 0), pages: Math.max(1,Math.ceil(Number(countResult.rows[0]?.count || 0)/100)) },
    actionRuns: actionRows.rows.map(run => { const workspace = /finance|payment|qbo/.test(run.action_key) || run.entity_type === 'finance' ? 'Finance' : /payroll|crew/.test(run.action_key) || run.entity_type === 'employee' ? 'Krewe' : /fleet|truck/.test(run.action_key) || run.entity_type === 'truck' ? 'Fleet' : /marketing|lead|review/.test(run.action_key) ? 'Marketing' : 'Schedule'; return { id: run.id, key: run.action_key, status: run.status, workspace, href: sourceHref(date,workspace), requestedAt: new Date(run.requested_at).toISOString() }; }),
    closeouts: open.map(job => ({ id: job.recordId, appointmentId: job.appointmentId, jk: job.jkNumber, customer: job.customerName, truck: truckLabel(job.truck), window: job.appointmentTime, category: appointmentCategory(job), amount: appointmentCategory(job) === 'Estimate' ? null : finite(job.paymentAmount), detail: `${job.status || 'Disposition unavailable'} · Source appointment ${job.appointmentId || 'unavailable'}`, href: job.appointmentUrl || sourceHref(date, 'Schedule') })),
    routes: routeTrucks.map(truck => { const jobs = appointments.filter(job => truckLabel(job.truck) === truck); const telemetry = schedule.fleet.trucks.find(row => truckLabel(row.truck) === truck); return { truck, crew: [...new Set(jobs.flatMap(job => [job.driver, job.navigator]).filter(Boolean))].join(' · ') || 'Assignment unavailable', status: telemetry?.operationalStatus || 'GPS status unavailable', stops: jobs.length, complete: jobs.filter(isClosed).length, next: jobs.find(job => !isClosed(job))?.jkNumber || 'No open appointment', freshness: telemetry?.freshnessLabel || 'GPS unavailable' }; }),
    sources: readDesktopSourceHealth(canFinance).map(source => ({name:source.name,state:source.state,tone:source.tone,detail:source.area,observedAt:source.observedAt})),
    audit: audits.rows.map(event => ({ id: event.id, at: new Date(event.occurred_at).toISOString(), action: event.event_type.replace(/^work\.|^control\.|\.v1$/g, '').replaceAll('_', ' '), actor: names.get(event.actor_id) || 'System', record: event.aggregate_id, before: String(event.payload_json.fromStatus || event.payload_json.previousStatus || '—'), after: String(event.payload_json.toStatus || event.payload_json.status || 'Recorded'), reason: String(event.payload_json.reason || '') })),
    counts: { approval: actionCount('awaiting_approval'), verifying: actionCount('verifying'), verified: actionCount('succeeded') },
  };
}

export async function executeDesktopControl(raw: unknown, identity: Identity) {
  const input = parseControlRequest(raw);
  const definition = CONTROL_ACTION_DEFINITIONS[input.action];
  if (!opsRoleCan(identity.role, definition.permission)) throw new Error('Your role does not include this action.');
  const actor = await ensureHumanOperator(identity.email);
  // A saved receipt stays readable when a source subsequently becomes unavailable.
  const prior = await getKernelPool().query<{ input_json: ControlRequest; verification_json: Record<string, unknown> }>('SELECT input_json,verification_json FROM opscenter_kernel.action_runs WHERE action_key=$1 AND idempotency_key=$2', [definition.key, `${actor.id}:${input.requestId}`]);
  if (prior.rows[0]) {
    if (hash(prior.rows[0].input_json) !== hash(redactOperationalValue(input))) throw new Error('This request ID already belongs to a different action.');
    return prior.rows[0].verification_json;
  }
  // Gate facts are re-read by the server; browser-authored counts never become evidence.
  const snapshot = ['own_gate', 'start_day', 'close_day'].includes(input.action) ? await readDesktopControl(input.date, identity) : null;
  return withKernelTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`control:${actor.id}:${input.requestId}`]);
    const existing = await client.query<{ input_json: ControlRequest; verification_json: Record<string, unknown> }>(`SELECT input_json,verification_json FROM opscenter_kernel.action_runs WHERE action_key = $1 AND idempotency_key = $2`, [definition.key, `${actor.id}:${input.requestId}`]);
    if (existing.rows[0]) {
      if (hash(existing.rows[0].input_json) !== hash(redactOperationalValue(input))) throw new Error('This request ID already belongs to a different action.');
      return existing.rows[0].verification_json;
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`operating-day:${input.date}`]);
    const correlationId = createCorrelationId();
    const now = new Date().toISOString();
    let itemId = input.itemId;
    let resultingVersion: number;
    let aggregateType = 'work_item';
    let aggregateId = itemId || input.date;
    let previousStatus = '';
    let status = '';
    if (['start_day', 'close_day', 'reopen_day'].includes(input.action)) {
      if (input.date !== today()) throw new Error('Operating-day transitions require the current Chicago date.');
      const day = await readDay(client, input.date);
      if (day.version !== input.expectedVersion) throw new Error('The operating day changed. Refresh before continuing.');
      if (input.action === 'start_day' && day.status !== 'planning' || input.action === 'close_day' && day.status !== 'operating' || input.action === 'reopen_day' && day.status !== 'closed') throw new Error('This operating-day transition is unavailable.');
      const gates = input.action === 'start_day' ? snapshot!.gates.start : input.action === 'close_day' ? snapshot!.gates.close : [];
      if (gates.some(gate => !controlGateCleared(gate))) throw new Error('Every readiness gate requires source evidence or a current owned handoff.');
      // Recheck owners/deadlines under row locks so concurrent resolution cannot
      // release a day using an exception that no longer has an active owner.
      for (const gate of gates.filter(gate => gate.count !== 0)) {
        const owner = await client.query(`SELECT id FROM opscenter_kernel.work_items WHERE id=$1 AND status NOT IN ('resolved','dismissed') AND owner_actor_id IS NOT NULL AND due_at > now() FOR UPDATE`, [gate.workItemId]);
        if (!owner.rowCount) throw new Error('A gate handoff changed. Refresh before continuing.');
      }
      previousStatus = day.status;
      status = input.action === 'close_day' ? 'closed' : 'operating';
      resultingVersion = day.version + 1;
      aggregateType = 'operating_day'; aggregateId = input.date;
      await appendPlatformEvent(client, { eventType: 'control.day_changed.v1', eventVersion: 1, aggregateType, aggregateId, actorId: actor.id, occurredAt: now, correlationId, payload: { status, previousStatus, version: resultingVersion, reason: input.reason, action: input.action, gates: gates.map(gate => ({ id: gate.id, count: gate.count, evidenceVersion: gate.evidenceVersion, workItemId: gate.workItemId })) } });
      const readBack = await readDay(client, input.date);
      if (readBack.version !== resultingVersion || readBack.status !== status) throw new Error('Operating-day read-back failed.');
    } else if (input.action === 'own_gate') {
      const gate = [...snapshot!.gates.start, ...snapshot!.gates.close].find(item => item.id === input.gateId);
      if (!gate || gate.evidenceVersion !== input.evidenceVersion) throw new Error('Gate evidence changed. Refresh before planning a handoff.');
      if (gate.category === 'Finance' && !opsRoleCan(identity.role, 'finance.read')) throw new Error('Your role does not include this gate.');
      if (gate.count === 0) throw new Error('This gate is already source ready.');
      if (gate.workItemId) throw new Error('This gate already has an owner. Manage the existing handoff.');
      itemId = createPlatformId('work'); aggregateId = itemId;
      const entityId = `gate:${input.date}:${gate.id}:${gate.evidenceVersion}`;
      const dedupeKey = hash(entityId);
      // Deterministic dedupe prevents another request ID from duplicating a gate handoff.
      const duplicate = await client.query('SELECT id FROM opscenter_kernel.work_items WHERE dedupe_key=$1', [dedupeKey]);
      if (duplicate.rowCount) throw new Error('This gate has a prior handoff. Reopen or update it in Operating Decisions.');
      await client.query(`INSERT INTO opscenter_kernel.work_items (id,dedupe_key,operating_date,rule,category,severity,entity_type,entity_id,entity_label,title,description,source,source_observed_at,status,owner_actor_id,due_at,first_detected_at,last_detected_at) VALUES ($1,$2,$3,$4,$5,'warning','platform',$6,$7,$7,$8,'Manual entry',$9,'open',$10,$11,$9,$9)`, [itemId,dedupeKey,input.date,`manual_follow_up.${itemId}`,gate.category,entityId,`${gate.id.startsWith('start:') ? 'Start-of-Day' : 'Carryover'} · ${gate.title}`,`${gate.detail}\nSource: ${gate.source}\nReason and next action: ${input.reason}`,now,actor.id,input.dueAt]);
      status = 'open'; resultingVersion = 1;
      await appendPlatformEvent(client, { eventType: 'work.created.v1', eventVersion: 1, aggregateType, aggregateId, actorId: actor.id, occurredAt: now, correlationId, payload: { status, version: 1, ownerActorId: actor.id, dueAt: input.dueAt, reason: input.reason, gateId: gate.id, evidenceVersion: gate.evidenceVersion, operatingDate: input.date } });
    } else {
      const result = await client.query<{ id: string; version: number; status: WorkItemStatus; category: string; operating_date: Date | string; owner_actor_id: string | null }>('SELECT id,version,status,category,operating_date,owner_actor_id FROM opscenter_kernel.work_items WHERE id=$1 FOR UPDATE', [itemId]);
      const current = result.rows[0];
      if (!current) throw new Error('Work item not found.');
      if (current.version !== input.expectedVersion) throw new Error('The work item changed. Refresh before continuing.');
      const workDate = typeof current.operating_date === 'string' ? current.operating_date.slice(0, 10) : new Date(current.operating_date).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
      if (workDate > input.date) throw new Error('This item is outside the selected operating date.');
      if (current.category === 'Finance' && !opsRoleCan(identity.role, 'finance.read')) throw new Error('Your role does not include this work item.');
      previousStatus = current.status;
      status = input.action === 'handoff' ? input.status! : input.action === 'resolve_manually' ? 'resolved' : input.action === 'dismiss' ? 'dismissed' : input.action === 'reopen' ? 'open' : 'acknowledged';
      assertWorkItemTransition(current.status, status as WorkItemStatus);
      const owner = input.assignToSelf ? actor.id : current.owner_actor_id;
      if (input.action === 'handoff' && !owner) throw new Error('An accountable owner is required. Assign this work to yourself.');
      const resolution = input.action === 'resolve_manually' ? 'manual_resolution' : input.action === 'dismiss' ? 'operator_dismissed' : null;
      await client.query(`UPDATE opscenter_kernel.work_items SET status=$2,owner_actor_id=$3,due_at=COALESCE($4::timestamptz,due_at),snoozed_until=CASE WHEN $2='snoozed' THEN $4::timestamptz ELSE NULL END,resolution_code=$5,resolution_note=CASE WHEN $5::text IS NULL THEN NULL ELSE $6 END,resolved_at=CASE WHEN $5::text IS NULL THEN NULL ELSE now() END,version=version+1,updated_at=now() WHERE id=$1`, [itemId,status,owner,input.dueAt || null,resolution,input.reason]);
      resultingVersion = current.version + 1;
      await appendPlatformEvent(client, { eventType: `work.${input.action === 'resolve_manually' ? 'resolved_manually' : input.action}.v1`, eventVersion: 1, aggregateType, aggregateId, actorId: actor.id, occurredAt: now, correlationId, payload: { fromStatus: previousStatus, toStatus: status, version: resultingVersion, ownerActorId: owner, dueAt: input.dueAt, reason: input.reason, resolutionCode: resolution } });
    }
    if (itemId) {
      const verified = await client.query<{ version: number; status: string }>('SELECT version,status FROM opscenter_kernel.work_items WHERE id=$1', [itemId]);
      if (verified.rows[0]?.version !== resultingVersion || verified.rows[0]?.status !== status) throw new Error('Work-item read-back failed.');
    }
    const verification = { outcome: 'verified', verifiedAt: now, summary: input.action === 'resolve_manually' ? 'Manual resolution recorded. This does not verify an external source outcome.' : 'OpsCenter-owned state saved and read back.', evidence: { aggregateType, aggregateId, version: resultingVersion, status }, itemId };
    const runId = createPlatformId('action');
    await client.query(`INSERT INTO opscenter_kernel.action_runs (id,action_key,action_version,risk_class,actor_id,entity_type,entity_id,work_item_id,idempotency_key,input_json,status,policy_decision_json,requested_at,started_at,finished_at,verification_json,correlation_id) VALUES ($1,$2,1,1,$3,'platform',$4,$5,$6,$7::jsonb,'succeeded',$8::jsonb,$9,$9,$9,$10::jsonb,$11)`, [runId,definition.key,actor.id,aggregateId,itemId || null,`${actor.id}:${input.requestId}`,JSON.stringify(redactOperationalValue(input)),JSON.stringify({ outcome: 'allow', policyVersion: 'desktop-control.v1', reasons: [definition.permission,identity.role], decidedAt: now }),now,JSON.stringify(verification),correlationId]);
    return verification;
  });
}
