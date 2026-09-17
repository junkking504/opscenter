import assert from 'node:assert/strict';
import { assessTruck, type AgentSource, type TruckAgentInputs } from '../lib/truck-agent-rules';
import { projectTruckAgents } from '../lib/truck-agents';
const now = Date.parse('2026-09-17T16:30:00Z'), date = '2026-09-17', at = new Date(now).toISOString();
const source = <T>(data: T): AgentSource<T> => ({ data, available: true, observedAt: at, note: '' });
const location = { latitude: 30, longitude: -90 };
const truckLocation = { latitude: 30 + 136 / 111195, longitude: -90 };
function fixture(n = 3): TruckAgentInputs {
  const truck = `Truck ${n}`;
  return {
    identity: source([{ truck, tracker: `tracker-${n}` }]), repairs: source([]), maintenance: source([]), inspections: source([]), loads: source([]), costs: source([]), visits: source([]),
    schedule: source([{ id: 'synthetic-appointment', number: 'JKTEST', truck, status: 'Confirmed', crew: 'Example crew', start: 600, end: 660, time: '10–11 AM', photosMissing: false, chargesPending: false, location }]),
    gps: source([{ truck, at, speed: 0, ignition: 'ON', ...truckLocation, points: [3, 2, 1].map(minutes => ({ ...truckLocation, speed: 0, ignition: 'ON', timestamp: new Date(now - minutes * 60_000).toISOString() })) }]),
  };
}
const assess = (x: TruckAgentInputs, clock = now) => assessTruck(3, date, x, clock);
for (let n = 1; n <= 9; n++) {
  const x = fixture(n), before = JSON.stringify(x), a = assessTruck(n, date, x, now);
  assert.equal(a.summary.progress?.kind, 'nearby');
  assert.equal(a.summary.progress?.distanceMeters, 136);
  assert.equal(a.summary.progress?.stoppedSince, '2026-09-17T16:27:00.000Z');
  assert.match(a.summary.progress!.detail, /125-metre/);
  assert(a.recommendations.some(r => r.rule === 'appointment-progress'));
  assert(!a.recommendations.some(r => r.rule === 'window'), 'Progress context replaces generic overdue recommendation for that appointment');
  assert.equal(JSON.stringify(x), before, 'No source, coordinate or visit mutation');
}
for (const change of [
  (x: TruckAgentInputs) => { x.gps.data[0].speed = 20; },
  (x: TruckAgentInputs) => { x.gps.data[0].points = []; },
  (x: TruckAgentInputs) => { x.gps.data[0].points![2].speed = 20; },
  (x: TruckAgentInputs) => { x.gps.data[0].points = [{ ...truckLocation, speed: 0, timestamp: '2026-09-17T16:20:00Z' }]; },
  (x: TruckAgentInputs) => { x.gps.data[0].at = '2026-09-17T16:26:00Z'; },
  (x: TruckAgentInputs) => { x.gps.data[0].at = '2026-09-17T16:31:00Z'; },
  (x: TruckAgentInputs) => { x.gps.available = false; },
  (x: TruckAgentInputs) => { x.schedule.available = false; },
  (x: TruckAgentInputs) => { x.schedule.observedAt = '2026-09-17T16:20:00Z'; },
  (x: TruckAgentInputs) => { x.identity.data = []; },
  (x: TruckAgentInputs) => { x.identity.data.push({ truck: 'Truck 3', tracker: 'duplicate' }); },
  (x: TruckAgentInputs) => { x.schedule.data[0].location = null; },
  (x: TruckAgentInputs) => { x.schedule.data[0].status = 'Canceled'; },
  (x: TruckAgentInputs) => { x.schedule.data[0].truck = 'Virtual Truck'; },
  (x: TruckAgentInputs) => { x.gps.data[0].latitude = 31; },
]) { const x = fixture(); change(x); assert.equal(assess(x).summary.progress, null); }
const ambiguous = fixture(); ambiguous.schedule.data.push({ ...ambiguous.schedule.data[0], id: 'other-appointment', number: 'JKOTHER', truck: 'Truck 4' });
assert.match(assess(ambiguous).summary.progress!.detail, /Multiple open appointments/);
assert.equal(assess(ambiguous).summary.progress!.jobIds.length, 2);
const shutdown = fixture(); shutdown.gps.data[0].ignition = 'OFF'; shutdown.gps.data[0].points = shutdown.gps.data[0].points!.slice(-1);
assert.equal(assess(shutdown).summary.progress?.kind, 'nearby');
const onsite = fixture(); onsite.gps.data[0] = { ...onsite.gps.data[0], ...location, points: onsite.gps.data[0].points!.map(p => ({ ...p, ...location })) };
assert.equal(assess(onsite).summary.progress?.kind, 'on_site');
assert.equal(assess(onsite).summary.nextJob, null);
const departed = fixture(); departed.gps.data[0] = { ...departed.gps.data[0], latitude: 30.1, speed: 25 };
departed.visits.data.push({ truck: 'Truck 3', name: 'Example visit', appointmentId: 'synthetic-appointment', entered: '2026-09-17T16:00:00Z', departed: '2026-09-17T16:20:00Z' });
assert.equal(assess(departed).summary.progress?.kind, 'visited');
assert.equal(assess(departed).summary.nextJob, null);
departed.visits.data[0].conflict = true; assert.equal(assess(departed).summary.progress, null);
departed.visits.data[0].conflict = false; departed.visits.available = false; assert.equal(assess(departed).summary.progress, null);
const base = fixture(), first = projectTruckAgents(date, base, now), second = projectTruckAgents(date, base, now + 1000, first);
assert.equal(second.agents[2].history.length, 0, 'Repeated evidence does not create duplicate history');
assert.deepEqual(first.agents[2].recommendations.map(r => [r.id, r.version]), second.agents[2].recommendations.map(r => [r.id, r.version]));
const later = fixture(); later.gps.data[0].at = new Date(now + 60_000).toISOString(); later.gps.data[0].points!.push({ ...truckLocation, timestamp: at, speed: 0, ignition: 'ON' });
const extended = assess(later, now + 60_000);
assert.equal(extended.recommendations.find(r => r.rule === 'appointment-progress')?.version, first.agents[2].recommendations.find(r => r.rule === 'appointment-progress')?.version, 'Longer dwell alone does not reopen acknowledgment');
const parked = fixture(); parked.gps.data[0].ignition = 'OFF';
const parkedReport = assess(parked, now + 4 * 60_000);
// Keep the schedule current while exercising only the parked GPS heartbeat.
parked.schedule.observedAt = new Date(now + 4 * 60_000).toISOString();
assert.equal(assess(parked, now + 4 * 60_000).summary.progress?.label, 'Last report: stopped nearby — arrival unconfirmed');
assert.match(assess(parked, now + 4 * 60_000).summary.progress!.detail, /current position is unconfirmed/);
assert.equal(parkedReport.summary.progress, null, 'Stale schedule still prevents attribution');
parked.schedule.observedAt = new Date(now + 76 * 60_000).toISOString();
assert.equal(assess(parked, now + 76 * 60_000).summary.progress, null, 'Expired parked evidence cannot support nearby reporting');
const closed = fixture(); closed.schedule.data[0].status = 'Completed'; assert.equal(assess(closed).summary.progress, null);
console.log('Truck agent progress: all nine trucks, 136m boundary, stop evidence, ambiguous jobs, freshness, identity, arrival/departure and deduplication passed.');
