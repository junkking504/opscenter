import type { ActionRunStatus, WorkItemStatus } from "@/lib/platform/contracts";

const WORK_ITEM_TRANSITIONS: Record<WorkItemStatus, ReadonlySet<WorkItemStatus>> = {
  open: new Set(["acknowledged", "in_progress", "snoozed", "resolved", "dismissed"]),
  acknowledged: new Set(["open", "in_progress", "snoozed", "resolved", "dismissed"]),
  in_progress: new Set(["open", "snoozed", "resolved", "dismissed"]),
  snoozed: new Set(["open", "acknowledged", "in_progress", "resolved", "dismissed"]),
  resolved: new Set(["open"]),
  dismissed: new Set(["open"]),
};

const ACTION_RUN_TRANSITIONS: Record<ActionRunStatus, ReadonlySet<ActionRunStatus>> = {
  requested: new Set(["awaiting_approval", "denied", "queued", "cancelled"]),
  awaiting_approval: new Set(["denied", "queued", "cancelled"]),
  denied: new Set(),
  queued: new Set(["running", "failed", "cancelled"]),
  running: new Set(["verifying", "succeeded", "failed"]),
  verifying: new Set(["succeeded", "failed", "queued"]),
  succeeded: new Set(),
  failed: new Set(["queued", "cancelled"]),
  cancelled: new Set(),
};

export function canTransitionWorkItem(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return from === to || WORK_ITEM_TRANSITIONS[from].has(to);
}

export function assertWorkItemTransition(from: WorkItemStatus, to: WorkItemStatus): void {
  if (!canTransitionWorkItem(from, to)) {
    throw new Error(`Invalid work item transition: ${from} -> ${to}`);
  }
}

export function canTransitionActionRun(from: ActionRunStatus, to: ActionRunStatus): boolean {
  return from === to || ACTION_RUN_TRANSITIONS[from].has(to);
}

export function assertActionRunTransition(from: ActionRunStatus, to: ActionRunStatus): void {
  if (!canTransitionActionRun(from, to)) {
    throw new Error(`Invalid action run transition: ${from} -> ${to}`);
  }
}
