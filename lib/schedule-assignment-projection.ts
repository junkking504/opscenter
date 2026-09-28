import type { JobRow } from './desktop-schedule-source';
import type { JobRouteAssignment } from './job-route-assignments';

/** A write receipt bridges collection lag; it is not permanent source truth. */
export function applyScheduleAssignment<T extends JobRow>(source: T, override?: JobRouteAssignment, now = Date.now()): T {
  if (!override) return source;
  const observed = Date.parse(source.statusObservedAt || '');
  const verified = Date.parse(override.junkwareVerifiedAt || override.updatedAt);
  const sourceHasAssignment = Boolean(source.truck?.trim()) && !/^(?:unknown|unavailable|—)$/i.test(source.truck.trim());
  // Use this appointment's observation, never another market's file timestamp.
  // Pending/uncertain changes retain their explicit reconciliation state.
  if ((!override.junkwareSyncStatus || override.junkwareSyncStatus === 'verified')
    && sourceHasAssignment && Number.isFinite(observed) && observed <= now
    && Number.isFinite(verified) && observed > verified) return source;
  return {
    ...source, truck: override.truck || 'Unassigned', assignedTruck: override.truck || 'Unassigned',
    appointmentTime: override.appointmentTime || source.appointmentTime,
    appointmentStartMinutes: override.appointmentStartMinutes ?? source.appointmentStartMinutes,
    appointmentEndMinutes: override.appointmentEndMinutes ?? source.appointmentEndMinutes,
    hasScheduledTime: override.appointmentStartMinutes !== undefined || source.hasScheduledTime,
    junkwareSyncStatus: override.junkwareSyncStatus, junkwareSyncError: override.junkwareSyncError,
  };
}
