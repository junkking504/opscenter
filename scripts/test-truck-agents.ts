import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { assessTruck, agentHash, type TruckAgentInputs, type AgentSource } from '../lib/truck-agent-rules';
import type { TruckAgentSnapshot } from '../desktop-ui/lib/truck-agent-contract';

const date = '2026-09-17', now = Date.parse('2026-09-17T15:00:00Z'), stamp = new Date(now).toISOString();
const source = <T>(data: T): AgentSource<T> => ({ data, available: true, observedAt: stamp, note: '' });
function fixture(): TruckAgentInputs {
  return {
    identity: source(Array.from({ length: 9 }, (_, i) => ({ truck: `Truck ${i + 1}`, tracker: `tracker-${i + 1}` }))),
    repairs: source([]), maintenance: source([]),
    inspections: source([{ truck: 'Truck 4', at: stamp, href: '/inspection/4', status: 'clear', fuel: 'Full', odometer: '123456', findings: [] }]),
    schedule: source([{ id: 'test-1', number: 'JKTEST1', truck: 'Truck 4', status: 'Confirmed', crew: 'Example crew', end: 660, time: '10–11 AM', photosMissing: false, chargesPending: false }]),
    gps: source([{ truck: 'Truck 4', at: stamp, speed: 0, ignition: 'OFF' }]),
    loads: source([{ truck: 'Truck 4', label: 'Empty', percent: 0, at: stamp, uncertain: false, note: 'Inspection observation' }]),
    visits: source([]), costs: source([]),
  };
}
async function main() {
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'truck-agents-'));
process.env.OPSCENTER_DATA_DIR = root; process.env.OPSBOT_DATA_DIR = root;
process.env.OPSCENTER_AGENT_LOCK_HELD = '1';
const { projectTruckAgents, runTruckAgents, reviewTruckRecommendation, readTruckAgentReviewReceipt } = await import('../lib/truck-agents');
try {
  const input = fixture(), original = JSON.stringify(input);
  const all = projectTruckAgents(date, input, now);
  assert.equal(all.agents.length, 9); assert.equal(new Set(all.agents.map(a => a.id)).size, 9);
  assert.equal(all.agents[3].mode, 'Assigned route'); assert.equal(all.agents[3].summary.assigned, 1);
  assert.equal(JSON.stringify(input), original, 'Assessment does not mutate source inputs');

  const missing = fixture(); missing.identity.data = missing.identity.data.filter(t => t.truck !== 'Truck 5');
  assert.equal(assessTruck(5, date, missing, now).mode, 'Identity review');
  const transfer = fixture(); transfer.schedule.data[0].truck = 'Truck 9';
  const moved = projectTruckAgents(date, transfer, now + 1000, all);
  assert.equal(moved.agents[3].summary.assigned, 0); assert.equal(moved.agents[8].summary.assigned, 1);

  const stop = fixture(); stop.inspections.data[0].status = 'stop'; stop.inspections.data[0].findings = ['Brake concern'];
  stop.repairs.data.push({ id: 'r1', truck: 'Truck 4', title: 'Fuel', status: 'open', severity: 'out_of_service', owner: '', due: '', at: stamp }, { id: 'r2', truck: 'Truck 4', title: 'Fuel', status: 'resolved', severity: 'out_of_service', owner: '', due: '', at: stamp });
  const restricted = projectTruckAgents(date, stop, now);
  assert(restricted.agents[3].recommendations.some(r => r.rule === 'assigned-restriction'));
  assert(restricted.agents[3].recommendations.some(r => r.title === 'Reconcile repair status: Fuel'));
  const disposition = structuredClone(stop); disposition.inspections.data[0].status = 'stop_disposed'; disposition.repairs.data[0].status = 'resolved';
  assert(!projectTruckAgents(date, disposition, now + 1000, restricted).agents[3].recommendations.some(r => r.rule === 'inspection-stop'), 'Explicit same-day disposition clears only its stop recommendation');
  const vanished = structuredClone(stop); vanished.inspections.data = [{ ...vanished.inspections.data[0], href: '/different-inspection', status: 'clear', at: new Date(now + 1000).toISOString() }]; vanished.inspections.observedAt = new Date(now + 1000).toISOString();
  assert(projectTruckAgents(date, vanished, now + 1000, restricted).agents[3].recommendations.some(r => r.rule === 'inspection-stop'), 'Newer collection cannot erase a missing immutable stop report');
  const nextDay = assessTruck(4, '2026-09-18', stop, now + 86_400_000);
  assert(nextDay.recommendations.some(r => r.rule === 'inspection-stop'), 'A day rollover cannot clear a stop report');
  assert(nextDay.recommendations.some(r => r.rule === 'inspection-missing'), 'Yesterday’s report does not satisfy today’s inspection');
  const newerClear = structuredClone(stop); newerClear.inspections.data.push({ ...newerClear.inspections.data[0], at: new Date(now + 1000).toISOString(), status: 'clear', findings: [] });
  assert(assessTruck(4, date, newerClear, now + 2000).recommendations.some(r => r.rule === 'inspection-stop'));

  const failed = fixture(); failed.repairs = { ...failed.repairs, available: false, note: 'Corrupt repair file' };
  const retained = projectTruckAgents(date, failed, now + 2000, restricted);
  assert(retained.agents[3].recommendations.some(r => r.rule === 'repair'), 'Unavailable repair file cannot clear restrictions');
  const lost = fixture(); lost.inspections.data = []; lost.inspections.observedAt = null;
  assert(projectTruckAgents(date, lost, now + 2000, restricted).agents[3].recommendations.some(r => r.rule === 'inspection-stop'), 'Lost inspection index cannot replace retained evidence');
  const loadFailure = fixture(); loadFailure.loads.available = false;
  const retainedLoad = projectTruckAgents(date, loadFailure, now + 2000, all).agents[3];
  assert(retainedLoad.recommendations.some(r => r.rule === 'capacity'));
  assert.match(retainedLoad.summary.load, /needs confirmation/, 'Unavailable retained load cannot look like usable capacity');
  const older = fixture(); older.schedule.observedAt = '2026-09-17T14:00:00Z'; older.schedule.data = [];
  const regression = projectTruckAgents(date, older, now + 5000, all);
  assert.equal(regression.inputs.schedule.available, false); assert.equal(regression.inputs.schedule.data.length, 1);
  assert.equal(projectTruckAgents(date, fixture(), now - 1000, all), all, 'Older worker cannot overwrite a newer projection');
  const oldGps = fixture(); oldGps.gps.data[0].at = '2026-09-17T13:00:00Z';
  assert(assessTruck(4, date, oldGps, now).recommendations.some(r => r.rule === 'gps'));
  const staleSchedule = fixture(); staleSchedule.schedule.observedAt = '2026-09-17T13:00:00Z'; staleSchedule.schedule.data[0].end = 480;
  const staleResult = assessTruck(4, date, staleSchedule, now);
  assert(!staleResult.recommendations.some(r => r.rule === 'window'), 'Stale schedule cannot assert delay');
  assert(staleResult.recommendations.some(r => r.rule === 'schedule-freshness'));
  const futureGps = fixture(); futureGps.gps.data[0].at = '2026-09-18T13:00:00Z';
  assert(assessTruck(4, date, futureGps, now).recommendations.some(r => r.rule === 'gps'));

  const costs = fixture(); costs.costs.data = ['visit-1', 'visit-2'].map(id => ({ id, truck: 'Truck 4', note: 'Same facility: receipt review', at: stamp }));
  const receipts = assessTruck(4, date, costs, now).recommendations.filter(r => r.rule === 'receipt');
  assert.equal(receipts.length, 2); assert.notEqual(receipts[0].id, receipts[1].id, 'Different visits cannot share acknowledgment');
  costs.costs.data = costs.costs.data.slice(1);
  assert.equal(assessTruck(4, date, costs, now).recommendations.filter(r => r.rule === 'receipt').length, 1, 'Late actual resolves only matching receipt exception');

  const saved = runTruckAgents(date, { now, input });
  const repeated = runTruckAgents(date, { now: now + 1000, input });
  assert.deepEqual(saved.agents[3].recommendations.map(r => [r.id, r.version]), repeated.agents[3].recommendations.map(r => [r.id, r.version]));
  assert.equal(repeated.agents[3].history.length, 0, 'No duplicate history on heartbeat');
  assert.equal(fs.statSync(path.join(root, 'fleet/truck-agents', `${date}.json`)).mode & 0o777, 0o600);
  const readSnapshot = (): TruckAgentSnapshot => ({ version: 1, date, generatedAt: stamp, heartbeatAt: stamp, canWrite: true, agents: saved.agents, dispatcher: { unassigned: 0, scheduleAt: stamp, current: true }, warnings: [] });
  const rec = saved.agents[3].recommendations[0];
  const body = { date, recommendationId: rec.id, recommendationVersion: rec.version, expectedVersion: agentHash(null), status: 'acknowledged', requestId: randomUUID() };
  const receipt = reviewTruckRecommendation(body, 'manager', 'manager', { readSnapshot });
  assert.equal(receipt.status, 'verified');
  assert.deepEqual(reviewTruckRecommendation(body, 'manager', 'manager', { readSnapshot }), receipt, 'Exact retry returns saved result');
  assert.throws(() => reviewTruckRecommendation(body, 'other', 'manager', { readSnapshot }), /another operation/);
  assert.throws(() => reviewTruckRecommendation({ ...body, status: 'open' }, 'manager', 'manager', { readSnapshot }), /another operation/);
  assert.throws(() => reviewTruckRecommendation({ ...body, requestId: randomUUID() }, 'manager', 'manager', { readSnapshot }), /review changed/);
  assert.equal(readTruckAgentReviewReceipt(body.requestId, 'other'), null);
  assert.equal(readTruckAgentReviewReceipt(body.requestId, 'manager')?.status, 'verified', 'Readback derives success from exact immutable revision without rerunning writer');
  const changed = { ...body, requestId: randomUUID(), recommendationVersion: 'a'.repeat(64) };
  assert.throws(() => reviewTruckRecommendation(changed, 'manager', 'manager', { readSnapshot }), /Recommendation changed/);
  assert.equal(fs.existsSync(path.join(root, 'fleet/truck-agents/requests', `${changed.requestId}.json`)), false, 'Rejected preflight leaves no uncertain intent');
  const intentPath = path.join(root, 'fleet/truck-agents/requests', `${body.requestId}.json`);
  const intent = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
  const pendingId = randomUUID();
  fs.writeFileSync(path.join(root, 'fleet/truck-agents/requests', `${pendingId}.json`), JSON.stringify({ ...intent, requestId: pendingId, revision: 2 }));
  assert.equal(readTruckAgentReviewReceipt(pendingId, 'manager')?.status, 'pending', 'Unpublished intent is never treated as success');
  const concurrentRec = saved.agents[2].recommendations[0];
  fs.writeFileSync(path.join(root, 'synthetic-snapshot.json'), JSON.stringify(readSnapshot()));
  const worker = `const fs=require('node:fs');const {reviewTruckRecommendation}=require(${JSON.stringify(path.join(process.cwd(), 'lib/truck-agents.ts'))});try{const receipt=reviewTruckRecommendation(JSON.parse(process.argv[1]),'manager','manager',{readSnapshot:()=>JSON.parse(fs.readFileSync(process.argv[2],'utf8'))});console.log(receipt.status);}catch(e){console.log('rejected');}`;
  const race = await Promise.all([1, 2].map(() => new Promise<string>((resolve, reject) => {
    const candidate = { ...body, recommendationId: concurrentRec.id, recommendationVersion: concurrentRec.version, expectedVersion: agentHash(null), requestId: randomUUID() };
    const child = spawn(process.execPath, ['--import', 'tsx', '-e', worker, JSON.stringify(candidate), path.join(root, 'synthetic-snapshot.json')], { env: process.env });
    let output = ''; child.stdout.on('data', text => { output += text; }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve(output.trim()) : reject(new Error(`Review worker failed: ${code}`)));
  })));
  assert.equal(race.filter(status => status === 'verified').length, 1, 'Exactly one concurrent reviewer can publish the same expected revision');
  fs.writeFileSync(path.join(root, 'fleet/truck-agents', `${date}.json`), '{');
  assert.throws(() => runTruckAgents(date, { now, input }), /history could not be read/);
  assert.equal(fs.readFileSync(path.join(root, 'fleet/truck-agents', `${date}.json`), 'utf8'), '{', 'Corrupt state is not overwritten');
  assert.throws(() => projectTruckAgents('2026-02-30', input, now), /valid operating date/);
  console.log('Truck agents: nine roles, assignment transfer, source loss/regression, rollover restrictions, receipt identity, idempotent review and restart recovery passed.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
