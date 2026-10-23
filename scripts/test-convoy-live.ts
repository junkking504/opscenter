import assert from 'node:assert/strict';
import { stopLine, truckJobs, dueDetail, attentionItems } from '../desktop-ui/lib/convoy-live';

const base: any = { status: 'Scheduled', appointmentType: 'Pickup', appointmentStartMinutes: 810, appointmentEndMinutes: 870, customerName: 'Smith' };
const jobs = [
  { ...base, recordId: '1', truck: 'Truck# 2', status: 'Completed', appointmentStartMinutes: 540 },
  { ...base, recordId: '2', truck: 'Truck 2' },
  { ...base, recordId: '3', truck: 'Truck 2', status: 'Canceled' },
  { ...base, recordId: '4', truck: 'Truck 3' },
];
const now = Date.now();
const today = truckJobs(jobs, 'Truck# 2', true, now);
assert.equal(today.total, 2); assert.equal(today.done, 1);
assert.equal(stopLine(today, true), 'Next · 1:30 PM Smith');
assert.equal(stopLine(truckJobs(jobs, 'Truck# 2', false, now), true), null, 'past days show no next stop');
assert.equal(stopLine({ total: 1, done: 1, stop: null, isToday: true }, true), 'No open stops');

const line = (kind: any, gps = true) => stopLine({ total: 1, done: 0, stop: { kind, label: '1:30 PM Smith' }, isToday: true }, gps);
assert.equal(line('on_site', true), 'On site · 1:30 PM Smith');
assert.match(line('on_site', false)!, /GPS not reporting/);
assert.doesNotMatch(line('on_site', false)!, /^On site/);
assert.match(line('at_job', false)!, /Last reported at job/);
assert.match(line('last_seen')!, /^Last seen at/);
for (const kind of ['ambiguous', 'unverified', 'untimed', 'last_seen']) assert.doesNotMatch(line(kind)!, /^Next ·/);
assert.equal(line('ambiguous'), 'Check current stop in Command');

assert.equal(dueDetail({ key: '', truckId: '', truck: '', serviceType: '', status: 'due', milesRemaining: -120.4, daysRemaining: 5 }), '120 mi past target · 5 days remaining');
const t: any = (id: string, extra = {}) => ({ id, label: `Truck# ${id}`, operatingStatus: 'Driving', checklist: 'Complete', fuel: null, gpsAt: null, ...extra });
const snap: any = { date: '2026-10-22', issues: [], maintenance: [] };
assert.equal(attentionItems(snap, [t('1', { operatingStatus: 'Offline' })], false).length, 0, 'GPS is not flagged on past days');
assert.equal(attentionItems(snap, [t('1', { operatingStatus: 'Offline' })], true)[0].kind, 'gps');
assert.equal(attentionItems(snap, [t('1', { fuel: { percent: 20, source: 'inspection' } })], true)[0].kind, 'fuel');
assert.equal(attentionItems(snap, [t('1', { fuel: { percent: 60, source: 'inspection' } })], true).length, 0);
console.log('Convoy live board passed: stop counts, honest stop lines, past days, GPS gating, exception rules.');

import { gpsReporting, liveGroup } from '../desktop-ui/lib/convoy-live';
// An out-of-service truck whose GPS is stale must not read as on site.
const oos: any = { operatingStatus: 'Offline', readiness: 'Out of service' };
assert.equal(liveGroup(oos, true), 'out');
assert.equal(gpsReporting(oos), false);
assert.match(stopLine({ total: 1, done: 0, stop: { kind: 'on_site', label: '1:30 PM Smith' }, isToday: true }, gpsReporting(oos))!, /GPS not reporting/);
assert.equal(gpsReporting({ operatingStatus: 'Driving' } as any), true);
assert.equal(gpsReporting({ operatingStatus: 'Historical GPS' } as any), false);
console.log('Convoy live board: out-of-service GPS gating passed.');
