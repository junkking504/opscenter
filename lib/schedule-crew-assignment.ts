import type { ScheduleReceipt } from './desktop-schedule-operations';
import { readCrewDispatchRequest } from './crew-dispatch-store';

export type ScheduleCrewAssignment = {
  truck: string; expectedVersion: number;
  state: 'pending' | 'assigned' | 'queued' | 'attention'; message: string;
};

/** Recover old combined receipts without starting or replaying a Waypoint release. */
export function recoverScheduleCrewAssignment(receipt: ScheduleReceipt): ScheduleCrewAssignment {
  const intent = receipt.crewAssignment!;
  const appointmentId = receipt.recordId.split(':appointment:')[1];
  try {
    const prior = readCrewDispatchRequest(intent.truck, receipt.requestId);
    if (prior) return {
      ...intent,
      state: prior.current?.appointmentId === appointmentId ? 'assigned' : 'queued',
      message: `A Waypoint release for ${intent.truck} was previously saved. Phone access follows its daily truck setup.`,
    };
    return {...intent, state: 'attention', message: 'The truck assignment is saved. Release the job separately in Crew Dispatch for Waypoint. Phone access follows its daily truck setup.'};
  } catch {
    return {...intent, state: 'attention', message: 'The truck assignment is saved. The previous Waypoint release could not be checked. Review Crew Dispatch before releasing the job.'};
  }
}
