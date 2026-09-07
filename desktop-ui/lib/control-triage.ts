import { controlItemActive, type ControlItem } from './control-contract';

export type ControlBucket = 'needs_action' | 'waiting' | 'verification' | 'resolved';
export const controlBucketLabels: Record<ControlBucket, string> = {
  needs_action: 'Needs Action', waiting: 'Waiting', verification: 'Awaiting Verification', resolved: 'Resolved',
};

// This is presentation, never authority to resolve a durable work item. A
// completed appointment clears only the open-window condition, not its photo,
// crew, payment, or manually recorded follow-up requirements.
export function controlBucket(item: ControlItem, now = Date.now()): ControlBucket {
  if (!controlItemActive(item)) return 'resolved';
  const observed = Date.parse(item.currentSource?.observedAt || '');
  const recorded = Date.parse(item.sourceObservedAt);
  if (item.rule === 'open_appointment_past_scheduled_window' && item.currentSource?.appointmentClosed === true
      && Number.isFinite(recorded) && observed > recorded && observed <= now + 10 * 60000) return 'verification';
  // A waiting item without an accountable, future handoff is actionable again.
  if (item.status === 'snoozed' && item.ownerActorId && !item.overdue && Date.parse(item.dueAt || '') > now) return 'waiting';
  return 'needs_action';
}

export function controlNextStep(item: ControlItem, now = Date.now()): string {
  const bucket = controlBucket(item, now);
  if (bucket === 'verification') return 'Newer appointment evidence is closed. Check source conditions; two distinct fresh observations are required to resolve this warning.';
  if (bucket === 'waiting') return item.resolutionNote || 'Follow up with the recorded owner by the deadline.';
  if (bucket === 'resolved') return item.resolutionNote || (item.status === 'dismissed' ? 'Dismissed with a recorded reason.' : 'Resolution recorded.');
  if (item.status === 'snoozed') return `Waiting handoff needs attention. ${item.recommendedAction}`;
  return item.recommendedAction;
}
