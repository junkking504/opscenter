import { separateCancellationContact } from '../lib/desktop-schedule-source';
import assert from 'node:assert/strict';
import { scheduleVisitState as fullScheduleVisitState } from '../lib/desktop-schedule-visits';
import { scheduleStatusTone } from '../desktop-ui/lib/schedule-contract';

const scheduleVisitState = (...args: Parameters<typeof fullScheduleVisitState>) => { const {onsiteTime, ...state} = fullScheduleVisitState(...args); return state; };
const now = Date.parse('2026-09-06T16:00:00Z');
const recent = '2026-09-06T15:59:30Z';
const trucks = [{ truck: 'Truck 4', lastGpsUpdate: recent }];
const job = { appointmentId: '1234', truck: 'Truck# 4' };
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
assert.deepEqual(scheduleVisitState({ ...job, truck: 'Truck 6' }, [visit], recent, trucks, now), { hasVisit: true, truckOnSite: false });
console.log('Schedule visit state passed: identity, confirmed visits, closed-state precedence, departure, truck matching, and freshness.');


const cancelledContact = separateCancellationContact({customerName:'Preview Customer 5045550123 123 Main St New Orleans, LA 70115 Cancelled via phone; no longer needed. Followup',phone:'(504) 555-0123',address:'123 Main St, New Orleans, 70115',status:'Canceled',cancellationReason:'Preview Customer 5045550123 123 Main St New Orleans, LA 70115 Cancelled via phone; no longer needed. Followup',appointmentNotes:[] as string[]});
assert.equal(cancelledContact.customerName,'Preview Customer');
assert.equal(cancelledContact.cancellationReason,'Cancelled via phone; no longer needed.');
assert.ok(cancelledContact.appointmentNotes.includes(cancelledContact.cancellationReason));
