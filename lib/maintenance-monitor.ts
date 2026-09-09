import fs from 'node:fs';
import path from 'node:path';
import { APPROVED_MODEL, APPROVED_MONTHLY_MICROS } from './metered-usage-policy';
import type { MaintenanceObservation, MaintenanceState, MaintenanceSnapshot } from '../desktop-ui/lib/maintenance-contract';

export const MONTHLY_BUDGET_MICROS = APPROVED_MONTHLY_MICROS;
export const CALL_RESERVATION_MICROS = 20_000;
export const MODEL = APPROVED_MODEL;
export const maintenanceDirectory = () => path.join(process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data'), 'integrations/opscenter-maintenance');
export const monthKey = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).format(new Date(now));
export function initialMaintenanceState(): MaintenanceState {
  return { version: 1, checkedAt: null, aiStatus: 'Waiting for first observation', incidents: [], months: {}, receipts: [] };
}
export function readMaintenanceState(directory = maintenanceDirectory()): MaintenanceState {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')) as MaintenanceState;
    // A damaged ledger must stop analysis, never silently reset the budget.
    if (state.version !== 1 || !Array.isArray(state.incidents) || !Array.isArray(state.receipts) || !state.months || typeof state.months !== 'object' || Array.isArray(state.months) ||
        Object.values(state.months).some(m => !m || typeof m !== 'object' || Array.isArray(m) || ['committedMicros','estimatedMicros','calls','inputTokens','outputTokens'].some(k => !Number.isSafeInteger(m[k as keyof typeof m]) || m[k as keyof typeof m] < 0))) throw new Error('Invalid maintenance state');
    return state;
  } catch (error) {
    // Missing history is not a new budget: preserve a fail-closed boundary.
    throw new Error('Maintenance state needs review; AI spending is paused.');
  }
}
export function saveMaintenanceState(state: MaintenanceState, directory = maintenanceDirectory()) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, 'state.json');
  const temporary = `${target}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, target);
}
export function maintenanceSnapshot(now = Date.now(), directory = maintenanceDirectory()): MaintenanceSnapshot {
  let state: MaintenanceState;
  try { state = readMaintenanceState(directory); } catch {
    return { available: false, fresh: false, checkedAt: null, mode: 'observe', aiStatus: 'Maintenance state unavailable; AI paused', month: monthKey(now), budgetUsd: 10, committedUsd: 0, estimatedUsd: 0, calls: 0, incidents: [] };
  }
  const age = now - Date.parse(state.checkedAt || '');
  const month = monthKey(now), usage = state.months[month];
  return { available: Boolean(state.checkedAt), fresh: age >= 0 && age < 180_000, checkedAt: state.checkedAt,
    mode: 'observe', aiStatus: state.aiStatus, month, budgetUsd: 10,
    committedUsd: (usage?.committedMicros || 0) / 1e6, estimatedUsd: (usage?.estimatedMicros || 0) / 1e6,
    calls: usage?.calls || 0, incidents: state.incidents };
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const count = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
export type MaintenanceProbes = { health: unknown; readiness: unknown; login: boolean | null; clientEvents?: Record<string, { at: number; count: number }> };
export function detectMaintenance(probes: MaintenanceProbes, now = Date.now()): MaintenanceObservation[] {
  const h = object(probes.health), r = object(probes.readiness), q = object(r.photoQueue), counts = object(q.counts), sync = object(r.crewPortalSync);
  const rows: MaintenanceObservation[] = [];
  const add = (key: string, title: string, area: string, unhealthy: boolean | null, evidence: string, nextStep: string, kind: 'technical' | 'review' = 'technical') => rows.push({ key, title, area, unhealthy, evidence, nextStep, kind });
  add('availability', 'OpsCenter availability', 'Command', probes.login === null ? true : !probes.login, probes.login ? 'Login route responded successfully.' : 'Login route did not respond successfully.', 'Check the OpsCenter process and local listener before proposing a restart.');
  const validHealth = typeof h.ok === 'boolean' && ['healthy','available','missing-data','unreadable-data','stale-data','stale-linxup-data','stale-junkware-schedule','assignment-storage-unwritable','operator-storage-unwritable','platform-kernel-unhealthy','degraded-linxup-v3-fallback'].includes(String(h.status));
  add('health-probe', 'Health evidence unavailable', 'Command', !validHealth, validHealth ? 'Health returned structured evidence.' : 'Health request failed or returned an invalid response.', 'Check the health endpoint and application service.');
  add('readiness-probe', 'Readiness evidence unavailable', 'Command', typeof r.ok !== 'boolean', typeof r.ok === 'boolean' ? 'Readiness returned structured evidence.' : 'Readiness request failed or returned an invalid response.', 'Check the readiness endpoint before concluding that queues are clear.');
  const status = ['missing-data','unreadable-data','stale-data'].includes(String(h.status));
  add('metrics', 'Daily metrics unavailable or stale', 'Command', validHealth ? status : null, status ? `Metrics condition: ${h.status}.` : 'No metrics failure reported.', 'Check the daily collector and current operating date; preserve the last verified snapshot.');
  add('schedule', 'JunkWare schedule is stale', 'Schedule', bool(h.junkwareScheduleStale), `Verified schedule age: ${count(h.junkwareScheduleAgeSeconds) ?? 'unknown'} seconds.`, 'Check the JunkWare schedule detector and verified market snapshots; never infer an empty schedule.');
  add('gps', 'LinxUp locations are stale', 'Fleet', bool(h.linxupStale), `Location snapshot age: ${count(h.linxupAgeSeconds) ?? 'unknown'} seconds.`, 'Check the LinxUp receiver and collector; retain newest known positions and stale labels.');
  add('gps-fallback', 'LinxUp is using fallback delivery', 'Fleet', bool(h.linxupFallbackActive), h.linxupFallbackActive === true ? 'V2 fallback is active; V3 push is not current.' : 'No fallback condition reported.', 'Check V3 delivery while preserving the functioning fallback.');
  const writable = bool(h.operatorStateWritable), kernel = bool(object(h.platformKernel).healthy);
  add('storage', 'Operator storage is not writable', 'Command', writable === null ? null : !writable, writable ? 'Operator storage is writable.' : 'Storage write readiness failed or is unavailable.', 'Check disk space and documented storage permissions; do not delete operational records.');
  add('database', 'Platform database is unavailable', 'Command', kernel === null ? null : !kernel, kernel ? 'Database health passed.' : 'Database health failed or is unavailable.', 'Inspect the database connection; do not restart or modify the database automatically.');
  const crew = bool(sync.ok);
  add('crew-sync', 'Crew Portal publication needs attention', 'Krewe', crew === null ? null : !crew, crew ? 'Portal publication is verified and current.' : 'Portal publication is failed, stale, or unverified.', 'Check sync status and verify published data by reading it back.');
  const available = bool(q.available);
  add('photo-queue', 'Photo queue is unavailable', 'Command', available === null ? null : !available, available ? 'Photo queue directories are readable.' : 'Photo queue readability is unavailable.', 'Inspect the photo queue directories without changing records.');
  const held = count(counts.review), failed = count(counts.failed), incoming = count(counts.incoming), processing = count(counts.processing);
  add('photo-review', 'Photos need human review', 'Command', held === null || failed === null ? null : held + failed > 0, `${held ?? 'Unknown'} review records; ${failed ?? 'unknown'} failed records.`, 'Open photo review and confirm exact appointment identity. Held records are not proof of an application outage.', 'review');
  // Age only incoming/processing records, never the historical review backlog.
  const oldestActive = count(q.oldestActiveAgeSeconds);
  add('photo-processing', 'Photo processing is delayed', 'Command', incoming === null || processing === null || (incoming + processing > 0 && oldestActive === null) ? null : incoming + processing > 0 && oldestActive! > 600, `${incoming ?? 'Unknown'} incoming; ${processing ?? 'unknown'} processing; oldest active age ${oldestActive ?? 'unknown'} seconds.`, 'Inspect the dedicated photo worker and pending records; do not replay uncertain uploads.');
  for (const key of CLIENT_EVENT_KEYS) {
    const event = probes.clientEvents?.[key];
    const active = Boolean(event && now >= event.at && now - event.at < 600_000);
    add(`client-${key}`, key === 'javascript' ? 'Browser reported a runtime error' : `${key} requests reported failures`, key === 'schedule' ? 'Schedule' : 'Command', active, active ? `${event!.count} browser reports in the current reporting window.` : 'No recent browser failure reports.', 'Reproduce the affected live interaction and inspect its request or browser error. Absence of reports does not prove browser recovery.');
  }
  return rows;
}
export const CLIENT_EVENT_KEYS = ['javascript', 'schedule', 'command', 'control'] as const;
export function reconcileMaintenance(state: MaintenanceState, observations: MaintenanceObservation[], now = Date.now()) {
  const at = new Date(now).toISOString();
  // Multiple manual invocations cannot count as independent minute observations.
  if (state.checkedAt && now - Date.parse(state.checkedAt) < 45_000) return false;
  for (const observation of observations) {
    let incident = state.incidents.find(item => item.key === observation.key);
    if (observation.unhealthy === null) { if (incident) incident.goodChecks = 0; continue; }
    if (!incident && !observation.unhealthy) continue;
    if (!incident) {
      incident = { ...observation, status: 'confirming', firstSeenAt: at, lastSeenAt: at, resolvedAt: null, badChecks: 0, goodChecks: 0, occurrences: 1, attempts: 0 };
      state.incidents.push(incident);
    }
    if (observation.unhealthy) {
      if (incident.status === 'resolved') {
        Object.assign(incident, { firstSeenAt: at, resolvedAt: null, status: 'confirming', badChecks: 0, attempts: 0, attemptedAt: undefined, diagnosis: undefined, diagnosisAt: undefined, diagnosisStatus: undefined, occurrences: incident.occurrences + 1 });
      }
      Object.assign(incident, observation, { lastSeenAt: at, badChecks: incident.badChecks + 1, goodChecks: 0 });
      if (incident.badChecks >= 2 && incident.status === 'confirming') {
        incident.status = 'open'; state.receipts.push({ at, incident: incident.key, event: 'Confirmed on consecutive observations' });
      }
    } else {
      incident.badChecks = 0; incident.goodChecks += 1;
      if (incident.goodChecks >= 3 && incident.status !== 'resolved') {
        incident.status = 'resolved'; incident.resolvedAt = at;
        state.receipts.push({ at, incident: incident.key, event: incident.key.startsWith('client-') ? 'No recent browser reports; interaction recovery not verified' : 'Condition cleared on three observations; no repair performed' });
      }
    }
  }
  state.checkedAt = at; state.receipts = state.receipts.slice(-200);
  return true;
}
export function reserveMaintenanceCall(state: MaintenanceState, now = Date.now()): boolean {
  const month = monthKey(now);
  const ledger = state.months[month] ||= { committedMicros: 0, estimatedMicros: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
  if (!Number.isSafeInteger(ledger.committedMicros) || ledger.committedMicros < 0
    || !Number.isSafeInteger(ledger.calls) || ledger.calls < 0
    || ledger.calls >= 500 || ledger.committedMicros + CALL_RESERVATION_MICROS > MONTHLY_BUDGET_MICROS) return false;
  ledger.committedMicros += CALL_RESERVATION_MICROS; ledger.calls += 1; return true;
}
export function readClientEvents(directory = maintenanceDirectory()): Record<string, { at: number; count: number }> {
  const result: Record<string, { at: number; count: number }> = {};
  for (const key of CLIENT_EVENT_KEYS) {
    try { const item = JSON.parse(fs.readFileSync(path.join(directory, `${key}.json`), 'utf8')); if (Number.isFinite(item.at) && Number.isSafeInteger(item.count) && item.count > 0) result[key] = item; } catch { /* no reports */ }
  }
  return result;
}
export function recordClientEvent(key: string, directory = maintenanceDirectory(), now = Date.now()) {
  if (!(CLIENT_EVENT_KEYS as readonly string[]).includes(key)) return false;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, `${key}.json`);
  let previous: { at: number; count: number } = { at: 0, count: 0 };
  try { previous = JSON.parse(fs.readFileSync(target, 'utf8')); } catch { /* first report */ }
  if (now - previous.at < 30_000) return true;
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ at: now, count: now - previous.at < 600_000 ? Math.min((previous.count || 0) + 1, 1000) : 1 }), { mode: 0o600 });
  fs.renameSync(temporary, target); return true;
}
