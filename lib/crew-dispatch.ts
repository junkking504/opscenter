import type {WaypointDaySummary} from './waypoint-day-summary';
export type CrewAssignment = { assignmentId: string; appointmentId: string; date: string; releasedAt: string };
export type CrewDispatch = { truck: string; version: number; current: CrewAssignment | null; queued: CrewAssignment | null };
export type CrewCurrentJob = {
  assignmentId: string; appointmentId: string; date: string; jkNumber: string;
  customerName: string; address: string; appointmentTime: string;
  junkItems: string[]; appointmentNotes: string[]; driver: string; navigator: string;
};
export type CrewScheduledJob = Omit<CrewCurrentJob, 'assignmentId'> & { assignmentId?: string; status: string; appointmentType?: string; closedTotal?: number; estimateOutcomes?: string[] };
export type CrewCurrent = {
  state: 'assigned' | 'waiting' | 'unavailable'; truck: string; job: CrewCurrentJob | null;
  observedAt: string | null; message?: string; summary?: WaypointDaySummary; jobs?: CrewScheduledJob[]; completionPending?: boolean;
};
