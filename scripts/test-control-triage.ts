import assert from 'node:assert/strict';
import { controlBucket, controlNextStep } from '../desktop-ui/lib/control-triage';
import type { ControlItem } from '../desktop-ui/lib/control-contract';
import type { ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';
import { controlAppointmentEvidence } from '../lib/desktop-control-evidence';
import { reconcileControlDates } from '../lib/desktop-control-reconciliation';

async function main() {
  const now = Date.parse('2026-09-07T17:00:00Z');
  const item: ControlItem = {
    id: 'synthetic-work', version: 1, operatingDate: '2026-09-06', category: 'Jobs', severity: 'critical',
    title: 'Synthetic Open Appointment', description: 'Synthetic fixture only', source: 'Synthetic Schedule',
    sourceObservedAt: '2026-09-06T15:00:00Z', status: 'open', entity: { type: 'job', id: 'synthetic-appointment' },
    recommendedAction: 'Review appointment', overdue: true, carryover: true, rule: 'open_appointment_past_scheduled_window',
    currentSource: { status: 'Completed Duration 60 min', observedAt: '2026-09-06T22:00:00Z', appointmentClosed: true },
  };
  assert.equal(controlBucket(item, now), 'verification');
  assert.equal(item.status, 'open', 'Presentation never resolves durable work.');
  for (const rule of ['completed_job_with_no_closeout_photos', 'completed_job_with_no_driver', 'payment_amount_present_but_payment_type_missing', 'manual_follow_up.v1', undefined]) {
    assert.equal(controlBucket({ ...item, rule }, now), 'needs_action', `Completed does not clear ${rule}.`);
  }
  for (const observedAt of [item.sourceObservedAt, '2026-09-05T22:00:00Z', '2026-09-08T22:00:00Z', null]) {
    assert.equal(controlBucket({ ...item, currentSource: { ...item.currentSource!, observedAt } }, now), 'needs_action');
  }
  assert.equal(controlBucket({ ...item, currentSource: undefined }, now), 'needs_action');
  assert.equal(controlBucket({ ...item, status: 'resolved' }, now), 'resolved');
  assert.equal(controlBucket({ ...item, status: 'dismissed' }, now), 'resolved');
  const waiting: ControlItem = { ...item, rule: 'manual_follow_up.v1', status: 'snoozed', overdue: false, ownerActorId: 'synthetic-owner', dueAt: '2026-09-08T17:00:00Z' };
  assert.equal(controlBucket(waiting, now), 'waiting');
  assert.equal(controlBucket({ ...waiting, ownerActorId: undefined }, now), 'needs_action');
  assert.equal(controlBucket({ ...waiting, overdue: true }, now), 'needs_action');
  assert.equal(controlBucket({ ...waiting, dueAt: '2026-09-07T16:00:00Z' }, now), 'needs_action');
  assert.match(controlNextStep(item, now), /two distinct fresh observations/);
  const appointment = { recordId: 'synthetic-appointment', appointmentId: 'source-01', jkNumber: 'JK-SYNTHETIC', status: 'Completed Duration 60 min' } as ScheduleAppointment;
  const schedule = { observedAt: '2026-09-06T22:00:00Z', appointments: [appointment] };
  assert.equal(controlAppointmentEvidence(item.entity, schedule)?.appointmentClosed, true);
  for (const status of ['Confirmed', 'Not Completed', 'Cancellation Requested']) {
    assert.equal(controlAppointmentEvidence(item.entity, { ...schedule, appointments: [{ ...appointment, status }] })?.appointmentClosed, false);
  }
  const ambiguous = controlAppointmentEvidence({ type: 'job', id: 'JK-SYNTHETIC' }, { ...schedule, appointments: [appointment, { ...appointment, recordId: 'other', appointmentId: 'source-02' }] });
  assert.equal(ambiguous?.appointmentClosed, undefined, 'Ambiguous JK identity never suppresses urgency.');
  const checked: string[] = [];
  const result = await reconcileControlDates('2026-09-07', ['2026-09-06', '2026-09-05', '2026-09-06', '2026-09-08'], {
    ready: date => date !== '2026-09-07',
    reconcile: async date => { checked.push(date); if (date === '2026-09-05') throw new Error('Synthetic unavailable source'); },
  });
  assert.deepEqual(checked, ['2026-09-05', '2026-09-06']);
  assert.deepEqual(result.checked, ['2026-09-06'], 'Missing current metrics and one failing carryover do not block other eligible dates.');
  assert.deepEqual(result.skipped.map(row => row.date), ['2026-09-07', '2026-09-05']);
  assert.equal(result.remaining, 0);
  console.log('Control triage passed: source-specific closed evidence, identity ambiguity, timestamps, accountable waiting, partial carryover checks, and preserved unresolved state. Synthetic fixtures only; no database or provider writes.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
