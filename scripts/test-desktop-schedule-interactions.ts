import assert from 'node:assert/strict';
import { assignmentNeedsVerification, scheduleMoveRestriction, unavailableRoute, isClosed, scheduleMoveWindow, type ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';
import { scheduleMoveProposal } from '../desktop-ui/schedule-drag';

const job = { recordId: '2026-09-03:appointment:1234', appointmentId: '1234', jkNumber: 'JK1234567', truck: 'Truck 4', appointmentStartMinutes: 840, appointmentEndMinutes: 960, appointmentTime: '2:00 PM–4:00 PM', appointmentType: 'Estimate', status: 'Confirmed' } as ScheduleAppointment;
assert.deepEqual(scheduleMoveWindow(job, 960), { changed: true, supported: true, durationHours: 2, label: '4:00 PM–6:00 PM' });
assert.equal(scheduleMoveWindow(job, null).label, job.appointmentTime);
assert.equal(scheduleMoveWindow(job, 840).changed, false);
assert.equal(scheduleMoveWindow(job, 1380).supported, false, 'Moves cannot overflow the operating day');
assert.equal(scheduleMoveWindow(job, 870).supported, false, 'JunkWare retiming supports hourly starts only');
const halfHour = { ...job, appointmentStartMinutes: 870, appointmentEndMinutes: 930, appointmentTime: '2:30 PM–3:30 PM' };
assert.equal(scheduleMoveWindow(halfHour, 870).supported, true, 'Reassignment preserves an existing half-hour window');
assert.equal(scheduleMoveWindow(halfHour, 960).label, '4:00 PM–5:00 PM');
assert.equal(scheduleMoveWindow({ ...halfHour, appointmentEndMinutes: 960 }, 960).supported, false, 'Do not silently round a 90-minute appointment');
assert.equal(scheduleMoveWindow({ ...job, appointmentStartMinutes: null, appointmentEndMinutes: null }, 600).supported, false);
assert.equal(scheduleMoveWindow({ ...job, appointmentStartMinutes: 0, appointmentEndMinutes: 60, appointmentTime: '12:00 AM–1:00 AM' }, 0).changed, false);

const sharedJk = { ...job, recordId: '2026-09-03:appointment:5678', appointmentId: '5678', truck: 't12', appointmentStartMinutes: 900, appointmentEndMinutes: 960 };
const move = scheduleMoveProposal(job, 'Truck 12', 840, [job, sharedJk]);
assert.deepEqual(move.conflicts, ['JK1234567'], 'Distinct appointments with the same JK still conflict');
assert.equal(scheduleMoveProposal(job, 'Truck 12', 960, [job, sharedJk]).conflicts.length, 0, 'Touching windows do not overlap');
assert.equal(scheduleMoveProposal(job, 'Unassigned', 840, [job, sharedJk]).conflicts.length, 0);
assert.equal(scheduleMoveProposal(job, 'Truck 12', 840, [job, { ...sharedJk, status: 'Canceled' }]).conflicts.length, 0);
assert.equal(scheduleMoveProposal(halfHour, 'Truck 2', null, [halfHour]).start, null, 'A truck-only edit must not invent a new start');
assert.equal(isClosed({ ...job, status: 'Closed' }), true, 'Closed estimates are not movable');
assert.equal(assignmentNeedsVerification(job), false);
assert.equal(assignmentNeedsVerification({ junkwareSyncStatus: 'verified' }), false);
assert.equal(assignmentNeedsVerification({ junkwareSyncStatus: 'pending' }), true);
assert.equal(assignmentNeedsVerification({ junkwareSyncStatus: 'manual_correction' }), true);
console.log('Schedule interaction contracts passed: full windows, source duration, hourly constraints, independent identity, conflicts, and unverified-assignment safety.');

const route = { fromAppointmentId: job.recordId, toAppointmentId: sharedJk.recordId } as Parameters<typeof unavailableRoute>[0];
assert.match(unavailableRoute(route, [job, sharedJk]).detail, /verified coordinates/);
assert.equal(unavailableRoute(route, [{ ...job, location: { latitude: 30, longitude: -90 } }, { ...sharedJk, location: { latitude: 30.1, longitude: -90.1 } }]).label, "ETA Unavailable");
assert.equal(unavailableRoute(route, [{ ...job, location: { latitude: 30, longitude: -90 } }, sharedJk]).label, "Verify Address");

assert.equal(scheduleMoveRestriction(job), null);
assert.match(scheduleMoveRestriction({ ...job, appointmentType: "Job", status: "Completed" })!, /Completed appointments/);
assert.match(scheduleMoveRestriction({ ...job, status: "Canceled" })!, /Canceled appointments/);
assert.match(scheduleMoveRestriction({ ...job, junkwareSyncStatus: "pending" })!, /Verify the previous assignment/);
