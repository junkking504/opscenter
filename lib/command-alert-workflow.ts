import type { WorkItem } from "@/lib/platform/contracts";
import type { AlertWorkflowState } from "@/lib/operational-alert-presentation";

export const COMMAND_ALERT_RULE = "command_slack_alert.v1";
export type CommandAlertAction = "acknowledge" | "add_to_control";
export type CommandAlertWorkflowPayload = {
  items: WorkItem[];
  actor: { id: string; displayName: string };
};

/** Use the same surviving action on reads and writes after delivery duplicates
 * are combined. Existing owned follow-up takes precedence over a review mark.
 */
export function commandAlertWorkItemForSource(items: WorkItem[], source: {id: string; sourceMessageIds?: string[]}): WorkItem | undefined {
  const byId = new Map(items.map(item => [item.entity.id,item]));
  const candidates = [...new Set([source.id,...(source.sourceMessageIds || [])])].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  return candidates.find(item => commandAlertState(item) === 'in-control') || candidates[0];
}

export function commandAlertState(item?: WorkItem): AlertWorkflowState {
  if (!item) return "active";
  if (item.status === "resolved" || item.status === "dismissed") return "resolved";
  if (item.status === "in_progress" || item.ownerActorId) return "in-control";
  return item.status === "acknowledged" ? "acknowledged" : "active";
}

export function commandAlertControlHref(date: string, itemId: string): string {
  return `/?date=${encodeURIComponent(date)}&commandView=control&action=${encodeURIComponent(itemId)}#operating-inbox`;
}
