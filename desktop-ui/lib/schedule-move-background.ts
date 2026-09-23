import {
  scheduleMoveWindow,
  truckLabel,
  type MoveProposal,
  type ScheduleAppointment,
} from './schedule-contract';

export type BackgroundScheduleMove = {
  requestId: string;
  recordId: string;
  truck: string;
  start: number | null;
  end: number | null;
  label: string;
  phase: 'submitting' | 'verifying' | 'verified';
};

export function backgroundScheduleMove(move: MoveProposal, requestId: string): BackgroundScheduleMove {
  const window = scheduleMoveWindow(move.job, move.start);
  const duration = move.job.appointmentStartMinutes !== null && move.job.appointmentEndMinutes !== null
    ? move.job.appointmentEndMinutes - move.job.appointmentStartMinutes
    : null;
  const start = window.changed ? move.start : move.job.appointmentStartMinutes;
  return {
    requestId,
    recordId: move.job.recordId,
    truck: move.truck,
    start,
    end: start !== null && duration !== null ? start + duration : move.job.appointmentEndMinutes,
    label: window.label,
    phase: 'submitting',
  };
}

/** Keep the board responsive while the one durable source write and its read-back
 * continue. The pending sync flag prevents another move of this appointment. */
export function applyBackgroundScheduleMove(job: ScheduleAppointment, move: BackgroundScheduleMove): ScheduleAppointment {
  if (job.recordId !== move.recordId) return job;
  return {
    ...job,
    truck: move.truck === 'Unassigned' ? '' : move.truck,
    appointmentStartMinutes: move.start,
    appointmentEndMinutes: move.end,
    appointmentTime: move.label,
    hasScheduledTime: move.start !== null && move.end !== null,
    junkwareSyncStatus: 'pending',
    junkwareSyncError: '',
  };
}

/** A verified overlay can be retired only after the refreshed source-backed
 * schedule has caught up to the exact truck and time that were requested. */
export function sourceMatchesBackgroundScheduleMove(job: ScheduleAppointment, move: BackgroundScheduleMove) {
  return job.recordId === move.recordId
    && truckLabel(job.truck) === truckLabel(move.truck)
    && job.appointmentStartMinutes === move.start
    && job.appointmentEndMinutes === move.end
    && job.junkwareSyncStatus !== 'pending'
    && job.junkwareSyncStatus !== 'manual_correction';
}
