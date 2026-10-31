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
const ok = { gps: true, scheduleFresh: true };
assert.equal(stopLine(today, ok), 'Next · 1:30 PM Smith');
assert.equal(stopLine(truckJobs(jobs, 'Truck# 2', false, now), ok), null, 'past days show no next stop');
assert.equal(stopLine({ total: 1, done: 1, stop: null, isToday: true }, ok), 'No open stops');

const line = (kind: any, gps = true, scheduleFresh = true) => stopLine({ total: 1, done: 0, stop: { kind, label: '1:30 PM Smith' }, isToday: true }, { gps, scheduleFresh });
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
assert.match(line('on_site', gpsReporting(oos))!, /GPS not reporting/);
assert.match(line('at_job', gpsReporting(oos))!, /Last reported at job.*GPS not reporting/);
assert.equal(gpsReporting({ operatingStatus: 'Driving' } as any), true);
assert.equal(gpsReporting({ operatingStatus: 'Historical GPS' } as any), false);
console.log('Convoy live board: out-of-service GPS gating passed.');

// A failed schedule refresh must not leave a current-presence claim, even with fresh GPS.
for (const kind of ['on_site', 'at_job']) {
  const stale = line(kind, true, false)!;
  assert.match(stale, /^Last reported/); assert.match(stale, /schedule not refreshed/); assert.doesNotMatch(stale, /^(On site|At job)/);
}
assert.equal(line('next', true, false), 'Next · 1:30 PM Smith · schedule not refreshed');
assert.match(stopLine({ total: 0, done: 0, stop: null, isToday: true }, { gps: true, scheduleFresh: false })!, /not confirmed/);
assert.equal(line('on_site', true, true), 'On site · 1:30 PM Smith');
console.log('Convoy live board: stale-schedule presence passed.');

import { overviewSummary } from '../desktop-ui/lib/convoy-live';
const fleet = [
  t('1', {readiness:'Ready',operatingStatus:'Parked'}),
  t('2', {readiness:'Ready',operatingStatus:'Driving'}),
  t('3', {readiness:'In Use, No Inspection',inspectionStatus:'In Use, No Inspection'}),
  t('4', {readiness:'Out of service',inspectionStatus:'In Use, No Inspection'}),
  t('5', {readiness:'Ready',operatingStatus:'GPS Stale',fuel:{percent:10}}),
  t('6', {readiness:'Attention',operatingStatus:'Parked',checklist:'Missing'}),
  t('7', {readiness:'Ready',operatingStatus:'Parked'}),
];
const due: any[] = [
  {key:'7:oil',truckId:'7',truck:'Truck 7',serviceType:'Oil change',status:'due',milesRemaining:-10,daysRemaining:null},
  {key:'3:oil',truckId:'3',truck:'Truck 3',serviceType:'Oil change',status:'due',milesRemaining:0,daysRemaining:null},
  {key:'1:oil',truckId:'1',truck:'Truck 1',serviceType:'Oil change',status:'soon',milesRemaining:100,daysRemaining:null},
];
const summary = overviewSummary(snap,fleet,due,true);
assert.deepEqual(summary.counts,{ready:2,working:1,need:2,out:1},'counts are unique truck buckets, red facts win over activity, unknown is not Ready');
assert.deepEqual(summary.attention.map(a=>`${a.kind}:${a.truckId}`),['no_inspection:3','no_inspection:4','out_of_service:4','service:3','service:7']);
assert.equal(overviewSummary(snap,fleet,due,false).counts.working,0,'historical days never claim current activity');
assert.equal(summary.attention.some(a=>['gps','fuel','inspection','scheduled'].includes(a.kind)),false,'amber items stay out of Needs You');
assert.equal(overviewSummary({...snap,issues:[{truck:'1',severity:'out_of_service',status:'open'}]},[fleet[0]],[],true).counts.out,1,'active repair overrides readiness');
console.log('Overview: red-only stable ordering, distinct tile counts, stale GPS, historical activity, and repair precedence passed.');
