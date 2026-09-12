import { separateCancellationContact } from '../lib/desktop-schedule-source';
import assert from 'node:assert/strict';
import { scheduleVisitState as fullScheduleVisitState } from '../lib/desktop-schedule-visits';
import { appointmentStatus, scheduleStatusTone } from '../desktop-ui/lib/schedule-contract';

const scheduleVisitState = (...args: Parameters<typeof fullScheduleVisitState>) => { const {onsiteTime, onsiteTruck, lastSeenOnsiteTruck, lastSeenOnsiteAt, ...state} = fullScheduleVisitState(...args); return state; };
const now = Date.parse('2026-09-06T16:00:00Z');
const recent = '2026-09-06T15:59:30Z';
const location = { latitude: 29.97, longitude: -90.07 };
const trucks = [{ truck: 'Truck 4', lastGpsUpdate: recent, ...location }];
const job = { appointmentId: '1234', truck: 'Truck# 4', location };
const visit = { appointment_id: '1234', jk_number: 'JK4000001', truck_number: 'Truck 4', match_confidence: 'confirmed', visit_count: 1, first_arrival: '2026-09-06T15:50:00Z', visit_intervals: [{ arrival: '2026-09-06T15:50:00Z', departure: null }] };
const active = scheduleVisitState(job, [visit], recent, trucks, now);
assert.deepEqual(active, { hasVisit: true, truckOnSite: true });
assert.equal(scheduleStatusTone({ status: 'Confirmed', ...active }), 'on-site');
assert.equal(scheduleStatusTone({ status: 'Completed', ...active }), 'completed');
assert.equal(scheduleStatusTone({ status: 'Canceled', ...active }), 'canceled');
const departed = scheduleVisitState(job, [{ ...visit, visit_intervals: [{ arrival: visit.first_arrival, departure: recent }] }], recent, trucks, now);
assert.deepEqual(departed, { hasVisit: true, truckOnSite: false });
assert.equal(scheduleStatusTone({ status: 'Confirmed', ...departed }), 'visited');
assert.equal(scheduleStatusTone({ status: 'Confirmed' }), 'waiting');
assert.deepEqual(scheduleVisitState({ ...job, appointmentId: '5678' }, [visit], recent, trucks, now), { hasVisit: false, truckOnSite: false }, 'Separate appointments sharing a JK must not share visit state');
for (const invalid of [{ ...visit, match_confidence: 'ambiguous' }, { ...visit, pass_by_only: true }]) {
  assert.deepEqual(scheduleVisitState(job, [invalid], recent, trucks, now), { hasVisit: false, truckOnSite: false });
}
assert.equal(scheduleVisitState(job, [visit], '2026-09-06T15:00:00Z', trucks, now).truckOnSite, false, 'Stale visit snapshots cannot claim live on-site status');
assert.equal(scheduleVisitState(job, [visit], recent, [{ truck: 'Truck 4', lastGpsUpdate: '2026-09-06T15:00:00Z' }], now).truckOnSite, false, 'GPS must also be fresh');
assert.equal(scheduleVisitState(job, [visit], '2026-09-06T15:55:00Z', [{ ...trucks[0], lastGpsUpdate: '2026-09-06T15:55:00Z' }], now).truckOnSite, true, 'A five-minute continuous GPS delay is still live on-site evidence.');
const unassigned = fullScheduleVisitState({ ...job, truck: 'Unassigned' }, [visit], recent, trucks, now);
assert.equal(unassigned.truckOnSite, true, 'A fresh confirmed GPS visit must remain visible while JunkWare has not assigned the appointment.');
assert.equal(unassigned.onsiteTruck, 'Truck 4');
assert.deepEqual(scheduleVisitState({ ...job, truck: 'Truck 6' }, [visit], recent, trucks, now), { hasVisit: true, truckOnSite: true });
console.log('Schedule visit state passed: identity, confirmed visits, closed-state precedence, departure, truck matching, and freshness.');


const cancelledContact = separateCancellationContact({customerName:'Preview Customer 5045550123 123 Main St New Orleans, LA 70115 Cancelled via phone; no longer needed. Followup',phone:'(504) 555-0123',address:'123 Main St, New Orleans, 70115',status:'Canceled',cancellationReason:'Preview Customer 5045550123 123 Main St New Orleans, LA 70115 Cancelled via phone; no longer needed. Followup',appointmentNotes:[] as string[]});
const requestedCancel = separateCancellationContact({customerName:'Example Customer 9855550123 28010 E Example Dr PONCHATOULA, LA 70454 SMS - Customer requested to cancel. No reason provided. Followup',phone:'(985) 555-0123',address:'28010 E Example Dr, Ponchatoula, 70454',status:'Cancelled',cancellationReason:'Example Customer 9855550123 28010 E Example Dr PONCHATOULA, LA 70454 SMS - Customer requested to cancel. No reason provided. Followup',appointmentNotes:[] as string[]});
assert.equal(requestedCancel.customerName,'Example Customer');
assert.equal(requestedCancel.cancellationReason,'SMS - Customer requested to cancel. No reason provided.');
assert.equal(requestedCancel.appointmentNotes[0],requestedCancel.cancellationReason);
assert.equal(cancelledContact.customerName,'Preview Customer');
assert.equal(cancelledContact.cancellationReason,'Cancelled via phone; no longer needed.');
assert.ok(cancelledContact.appointmentNotes.includes(cancelledContact.cancellationReason));

const lastSeen=fullScheduleVisitState(job,[visit],recent,[{truck:'Truck 4',lastGpsUpdate:'2026-09-06T15:00:00Z'}],now);
assert.equal(lastSeen.truckOnSite,false);
assert.equal(lastSeen.lastSeenOnsiteTruck,'Truck 4','An open visit must not disappear when the GPS report ages out');
assert.equal(fullScheduleVisitState(job,[{...visit,visit_intervals:[{arrival:visit.first_arrival,departure:recent}]}],recent,trucks,now).lastSeenOnsiteTruck,undefined,'A recorded departure clears last-reported onsite state');

// The visit ledger can stay open after the tracker reports a different place.
const ledger = { ...visit, source_timestamps: ['2026-09-06T15:58:00Z'] };
const originalLedger = structuredClone(ledger);
const awayTruck = { ...trucks[0], latitude: 30.4 };
const away = fullScheduleVisitState(job, [ledger], recent, [awayTruck], now);
assert.equal(away.truckOnSite, false, 'Newer GPS elsewhere overrides a freshly collected open visit');
assert.equal(away.onsiteTruck, undefined);
assert.equal(away.lastSeenOnsiteTruck, undefined, 'Do not say last reported on site when the latest report is elsewhere');
assert.equal(away.hasVisit, true, 'Retain confirmed visit history');
assert.equal(appointmentStatus({ status: 'Confirmed', appointmentType: 'Job', ...away }), 'Visited · Closeout Pending');
assert.deepEqual(away.onsiteTime, fullScheduleVisitState(job, [ledger], recent, trucks, now).onsiteTime, 'Presence must not change recorded duration or invent departure');
assert.deepEqual(ledger, originalLedger, 'Never mutate the source visit');
const agedAway = fullScheduleVisitState(job, [ledger], recent, [awayTruck], now + 11 * 60_000);
assert.equal(agedAway.lastSeenOnsiteTruck, undefined, 'Aging an outside report cannot resurrect the older onsite location');
assert.equal(fullScheduleVisitState(job, [ledger], recent, [awayTruck], now + 13 * 3600_000).lastSeenOnsiteTruck, undefined, 'Even a long GPS outage cannot restore a superseded inside report');
assert.equal(fullScheduleVisitState(job, [ledger], recent, [{ ...awayTruck, lastGpsUpdate: '2026-09-06T15:57:00Z' }], now).lastSeenOnsiteTruck, 'Truck 4', 'An older outside fix cannot erase newer recorded onsite evidence');
for (const invalid of [
  { ...trucks[0], latitude: undefined },
  { ...trucks[0], latitude: NaN },
  { ...trucks[0], latitude: 91 },
  { ...trucks[0], longitude: -181 },
  { ...trucks[0], lastGpsUpdate: 'invalid' },
  { ...trucks[0], lastGpsUpdate: new Date(now + 120_000).toISOString() },
]) {
  const unknown = fullScheduleVisitState(job, [ledger], recent, [invalid], now);
  assert.equal(unknown.truckOnSite, false, 'An invalid fix cannot claim current onsite status');
  assert.equal(unknown.lastSeenOnsiteTruck, 'Truck 4', 'Missing evidence does not invent a departure');
}
assert.equal(fullScheduleVisitState({ ...job, location: null }, [ledger], recent, trucks, now).truckOnSite, false, 'An unverified job location cannot establish current presence');
assert.equal(fullScheduleVisitState(job, [ledger], recent, [], now).truckOnSite, false, 'Historical day without current trucks cannot claim current presence');
const parked = { ...trucks[0], speed: 0, ignition: 'OFF' };
assert.equal(fullScheduleVisitState(job, [ledger], new Date(now + 42 * 60_000).toISOString(), [parked], now + 42 * 60_000).truckOnSite, true, 'A valid onsite parked report remains current between hourly heartbeats');
const returned = { ...ledger, visit_intervals: [
  { arrival: visit.first_arrival, departure: '2026-09-06T15:55:00Z' },
  { arrival: '2026-09-06T15:59:00Z', departure: null },
] };
assert.equal(fullScheduleVisitState(job, [returned], recent, trucks, now).truckOnSite, true, 'A current inside fix supports a return visit');
assert.equal(fullScheduleVisitState(job, [returned], recent, [{ ...trucks[0], lastGpsUpdate: '2026-09-06T15:58:00Z' }], now).truckOnSite, false, 'An older fix cannot validate a later return arrival');
console.log('GPS versus ledger passed: away, stale, missing/invalid, parked, return visits, and immutable history.');
