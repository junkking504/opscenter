import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assessTruck, agentFresh, agentHash, agentDay, type TruckAgentInputs } from './truck-agent-rules';
import { readTruckAgentInputs, truckAgentRoot } from './truck-agent-inputs';
import { agentTruckNumber, type TruckAgentSnapshot, type TruckAgent } from '../desktop-ui/lib/truck-agent-contract';
import { validDesktopDate } from '../desktop-ui/lib/people-fleet-contract';
import { desktopVersion } from './desktop-krewe';
import { opsRoleCan, type InteractiveOpsRole } from './ops-roles';

type SavedAgents = { version: 1; date: string; heartbeatAt: string; inputs: TruckAgentInputs; agents: TruckAgent[] };
type Review = { recommendationId: string; recommendationVersion: string; status: 'acknowledged' | 'open'; actor: string; at: string; requestId: string };
const directory = () => path.join(truckAgentRoot(), 'fleet', 'truck-agents');
function read<T>(file: string): T | null { try { return JSON.parse(fs.readFileSync(path.join(directory(), file), 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('Truck agent history could not be read. Existing state has been preserved.'); } }
function atomic(file: string, value: unknown) {
  const target = path.join(directory(), file); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, target);
  const parent = fs.openSync(path.dirname(target), 'r'); try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}
function saved(date: string) { const value = read<SavedAgents>(`${date}.json`); if (value && (value.version !== 1 || value.date !== date || value.agents?.length !== 9 || !value.inputs)) throw new Error('Truck agent snapshot is incomplete.'); return value; }
function retainedInputs(input: TruckAgentInputs, prior?: TruckAgentInputs): TruckAgentInputs {
  return Object.fromEntries(Object.entries(input).map(([name, source]) => {
    const old = prior?.[name as keyof TruckAgentInputs];
    const regressed = old?.observedAt && (!source.observedAt || !Number.isFinite(Date.parse(source.observedAt)) || Date.parse(source.observedAt) < Date.parse(old.observedAt));
    if (old && (!source.available || regressed)) return [name, { ...old, available: false, note: regressed ? 'Older source evidence rejected; prior observations retained.' : source.note }];
    if (name === 'gps' && prior) {
      const missing = prior.gps.data.filter(point => point.at && !input.gps.data.some(next => next.truck === point.truck && next.at && Date.parse(next.at) >= Date.parse(point.at!)));
      if (missing.length) return [name, { ...input.gps, available: false, note: 'Some truck positions regressed or disappeared; their prior observations are retained.', data: [...input.gps.data.filter(point => !missing.some(old => old.truck === point.truck)), ...missing] }];
    }
    if (name === 'inspections' && prior) {
      const missing = prior.inspections.data.filter(report => report.status === 'stop' && !input.inspections.data.some(next => next.href === report.href));
      if (missing.length) return [name, { ...input.inspections, available: false, note: 'Stop report evidence disappeared without a linked repair disposition; prior reports retained.', data: [...input.inspections.data, ...missing] }];
    }
    return [name, source];
  })) as TruckAgentInputs;
}
export function projectTruckAgents(date: string, input: TruckAgentInputs, now: number, prior: SavedAgents | null = null): SavedAgents {
  if (!validDesktopDate(date)) throw new Error('A valid operating date is required.');
  if (prior && Date.parse(prior.heartbeatAt) > now) return prior;
  const inputs = retainedInputs(input, prior?.inputs), heartbeatAt = new Date(now).toISOString();
  const agents = Array.from({ length: 9 }, (_, i) => {
    const old = prior?.agents.find(a => a.id === `truck-${i + 1}`);
    try { return assessTruck(i + 1, date, inputs, now, old); }
    catch { return { ...(old || { id: `truck-${i + 1}`, truck: `Truck ${i + 1}`, mode: 'Readiness review', summary: { assigned: null, completed: null, nextJob: null, load: 'Unknown', gpsAt: null, inspectionAt: null }, recommendations: [], history: [], sources: [] }), status: 'error' as const, heartbeatAt, lastSuccessAt: old?.lastSuccessAt || null, error: 'Assessment failed. Prior recommendations retained for review.' }; }
  });
  return { version: 1, date, heartbeatAt, inputs, agents };
}
/** The existing Python runner holds its permanent OS lock; UI reads never publish state. */
export function runTruckAgents(date: string, options: { now?: number; input?: TruckAgentInputs } = {}) {
  if (process.env.OPSCENTER_AGENT_LOCK_HELD !== '1') throw new Error('Truck agents require the existing worker lock.');
  if (!validDesktopDate(date)) throw new Error('A valid operating date is required.');
  const prior = saved(date), now = options.now ?? Date.now();
  const result = projectTruckAgents(date, options.input || readTruckAgentInputs(date, now), now, prior);
  if (result !== prior) atomic(`${date}.json`, result);
  return result;
}
type ReviewRevision = { version: number; fingerprint: string; record: Review };
type ReviewIntent = { requestId: string; actor: string; fingerprint: string; date: string; id: string; recommendationVersion: string; revision: number; at: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reviewDirectory = (date: string, id: string, version: string) => `reviews/${date}/${agentHash({ id, version })}`;
function reviewRevisions(date: string, id: string, version: string): ReviewRevision[] {
  const folder = reviewDirectory(date, id, version);
  let files: string[];
  try { files = fs.readdirSync(path.join(directory(), folder)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return files.filter(f => /^\d+\.json$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b)).map((file, index) => {
    const r = read<ReviewRevision>(`${folder}/${file}`);
    if (!r || r.version !== index + 1 || r.record.recommendationId !== id || r.record.recommendationVersion !== version || !['acknowledged', 'open'].includes(r.record.status)) throw new Error('Truck agent review history is unavailable.');
    return r;
  });
}
/** Immutable compare-and-publish, following the existing knowledge revision store.
 * No process lock survives a crash; a request is recovered from its exact revision. */
function publishOnce(file: string, value: unknown) {
  const target = path.join(directory(), file); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${randomUUID()}.tmp`; const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temp, target); const parent = fs.openSync(path.dirname(target), 'r'); try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); } }
  finally { fs.unlinkSync(temp); }
}
export function readTruckAgentReviewReceipt(requestId: string, actor: string) {
  if (!uuid.test(requestId)) return null;
  const intent = read<ReviewIntent>(`requests/${requestId}.json`);
  if (!intent || intent.actor !== actor) return null;
  const revision = read<ReviewRevision>(`${reviewDirectory(intent.date, intent.id, intent.recommendationVersion)}/${intent.revision}.json`);
  const status = revision ? revision.fingerprint === intent.fingerprint && revision.record.requestId === requestId && revision.record.actor === actor ? 'verified' : 'failed' : 'pending';
  return { requestId, status, updatedAt: revision?.record.at || intent.at };
}
export function readTruckAgents(date: string, role: InteractiveOpsRole, now = Date.now()): TruckAgentSnapshot {
  if (!validDesktopDate(date)) throw new Error('A valid operating date is required.');
  const prior = saved(date), result = projectTruckAgents(date, readTruckAgentInputs(date, now), now, prior);
  const agents = result.agents.map(agent => ({ ...agent, recommendations: agent.recommendations.map(rec => {
    const review = reviewRevisions(date, rec.id, rec.version).at(-1)?.record || null;
    return { ...rec, review: review ? { status: review.status, actor: review.actor, at: review.at, version: rec.version } : null, reviewVersion: desktopVersion(review) };
  }) }));
  const schedule = result.inputs.schedule;
  return { version: 1, date, generatedAt: new Date(now).toISOString(), heartbeatAt: prior?.heartbeatAt || null, canWrite: opsRoleCan(role, 'operations.write'), agents,
    dispatcher: { unassigned: schedule.available ? schedule.data.filter(j => !agentTruckNumber(j.truck) && !/cancel|no.?show|complet|closed/i.test(j.status)).length : null, scheduleAt: schedule.observedAt, current: schedule.available && (date !== agentDay(now) || agentFresh(schedule.observedAt, now, 120)) },
    warnings: [ ...(!prior || !agentFresh(prior.heartbeatAt, now, 180) ? ['Background truck-agent heartbeat is unavailable or older than three minutes. This screen is an on-demand local assessment.'] : []), ...(date !== agentDay(now) ? ['Selected-day assessment uses currently retained repair records; it is not a reconstruction of historical mechanical readiness.'] : []) ] };
}
export function reviewTruckRecommendation(body: Record<string, unknown>, actor: string, role: InteractiveOpsRole, options: { readSnapshot?: typeof readTruckAgents } = {}) {
  if (!opsRoleCan(role, 'operations.write')) throw new Error('Your role cannot review truck recommendations.');
  const date = String(body.date || ''), id = String(body.recommendationId || ''), version = String(body.recommendationVersion || ''), status = String(body.status || '');
  const requestId = String(body.requestId || ''), expectedVersion = String(body.expectedVersion || '');
  if (!validDesktopDate(date) || !/^[a-f0-9]{64}$/.test(version) || id.length > 250 || !id || !['acknowledged', 'open'].includes(status) || !uuid.test(requestId) || !/^[a-f0-9]{64}$/.test(expectedVersion)) throw new Error('Choose a current recommendation and review action.');
  const fingerprint = agentHash({ date, id, version, status, expectedVersion, actor });
  const existing = read<ReviewIntent>(`requests/${requestId}.json`);
  if (existing) {
    if (existing.actor !== actor || existing.fingerprint !== fingerprint) throw new Error('Request ID belongs to another operation.');
    return readTruckAgentReviewReceipt(requestId, actor)!;
  }
  const snapshot = (options.readSnapshot || readTruckAgents)(date, role);
  if (!snapshot.agents.some(a => a.recommendations.some(r => r.id === id && r.version === version))) throw new Error('Recommendation changed. Refresh before reviewing.');
  const previous = reviewRevisions(date, id, version), current = previous.at(-1)?.record || null;
  if (desktopVersion(current) !== expectedVersion) throw new Error('This review changed. Refresh before saving.');
  const at = new Date().toISOString();
  const intent: ReviewIntent = { requestId, actor, fingerprint, date, id, recommendationVersion: version, revision: previous.length + 1, at };
  try { publishOnce(`requests/${requestId}.json`, intent); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; const winner = read<ReviewIntent>(`requests/${requestId}.json`); if (winner?.fingerprint !== fingerprint || winner.actor !== actor) throw new Error('Request ID belongs to another operation.'); return readTruckAgentReviewReceipt(requestId, actor)!; }
  const record: Review = { recommendationId: id, recommendationVersion: version, status: status as Review['status'], actor, at, requestId };
  try { publishOnce(`${reviewDirectory(date, id, version)}/${intent.revision}.json`, { version: intent.revision, fingerprint, record } satisfies ReviewRevision); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return readTruckAgentReviewReceipt(requestId, actor)!;
}
