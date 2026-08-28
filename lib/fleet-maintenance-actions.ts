import { effectiveFleetChecklistDefinitions, type FleetChecklistCustomization } from "@/lib/fleet-checklist-definitions";
import type { FleetChecklistEntry } from "@/lib/fleet-checklists";
import type { FleetIssue } from "@/lib/fleet-issues";
import type { FleetMapPayload } from "@/lib/fleet-map";

export type FleetMaintenanceActionKind = "repair" | "checklist" | "telemetry" | "mapping";
export type FleetMaintenanceActionPriority = "stop" | "urgent" | "next" | "watch";

export type FleetMaintenanceAction = {
  id: string;
  kind: FleetMaintenanceActionKind;
  priority: FleetMaintenanceActionPriority;
  truck: string;
  title: string;
  detail: string;
  actionLabel: string;
  issueId?: string;
};

type FleetMaintenanceActionInput = {
  today: string;
  truckOptions: string[];
  entries: FleetChecklistEntry[];
  customizations: FleetChecklistCustomization[];
  issues: FleetIssue[];
  fleetMap: FleetMapPayload | null;
};

const priorityRank: Record<FleetMaintenanceActionPriority, number> = { stop: 0, urgent: 1, next: 2, watch: 3 };

function activeRepairAction(issue: FleetIssue, today: string): FleetMaintenanceAction {
  if (issue.severity === "out_of_service") {
    return { id: `repair:${issue.issueId}`, kind: "repair", priority: "stop", truck: issue.truck, title: "Return-to-service decision required", detail: `${issue.title}${issue.owner ? ` · Owner: ${issue.owner}` : " · No owner assigned"}`, actionLabel: "Open repair", issueId: issue.issueId };
  }
  if (issue.dueDate && issue.dueDate < today) {
    return { id: `repair:${issue.issueId}`, kind: "repair", priority: "urgent", truck: issue.truck, title: "Repair is overdue", detail: `${issue.title} · Due ${issue.dueDate}${issue.owner ? ` · Owner: ${issue.owner}` : " · No owner assigned"}`, actionLabel: "Update repair", issueId: issue.issueId };
  }
  if (!issue.owner) {
    return { id: `repair:${issue.issueId}`, kind: "repair", priority: "next", truck: issue.truck, title: "Assign repair owner", detail: `${issue.title}${issue.dueDate ? ` · Due ${issue.dueDate}` : " · No due date"}`, actionLabel: "Assign owner", issueId: issue.issueId };
  }
  if (!issue.dueDate) {
    return { id: `repair:${issue.issueId}`, kind: "repair", priority: "next", truck: issue.truck, title: "Set repair due date", detail: `${issue.title} · Owner: ${issue.owner}`, actionLabel: "Set due date", issueId: issue.issueId };
  }
  return { id: `repair:${issue.issueId}`, kind: "repair", priority: "watch", truck: issue.truck, title: "Repair work order is open", detail: `${issue.title} · ${issue.status.replace("_", " ")} · Due ${issue.dueDate}`, actionLabel: "Open repair", issueId: issue.issueId };
}

export function buildFleetMaintenanceActions({ today, truckOptions, entries, customizations, issues, fleetMap }: FleetMaintenanceActionInput): FleetMaintenanceAction[] {
  const actions: FleetMaintenanceAction[] = [];

  for (const issue of issues.filter((candidate) => candidate.status !== "resolved")) actions.push(activeRepairAction(issue, today));

  for (const truck of truckOptions) {
    const daily = entries.find((entry) => entry.truck === truck && entry.cadence === "daily" && entry.periodKey === today);
    const required = effectiveFleetChecklistDefinitions(truck, "daily", customizations).length;
    const complete = Boolean(daily?.completedAt && daily.answers.length === required && daily.inspector);
    if (!complete) actions.push({ id: `checklist:${truck}:${today}`, kind: "checklist", priority: "next", truck, title: "Daily inspection is incomplete", detail: `${daily?.answers.length || 0}/${required} required items checked`, actionLabel: "Open checklist" });
  }

  if (fleetMap?.isToday) {
    for (const truck of fleetMap.trucks) {
      if (truck.freshnessLabel === "Live GPS") continue;
      actions.push({ id: `telemetry:${truck.truck}`, kind: "telemetry", priority: truck.freshnessLabel === "Offline" ? "urgent" : "watch", truck: truck.truck, title: truck.freshnessLabel === "Offline" ? "Tracker has stopped reporting" : "GPS freshness needs review", detail: `${truck.freshnessLabel}${truck.lastGpsUpdate ? ` · Last report ${truck.lastGpsUpdate}` : ""}`, actionLabel: "View live map" });
    }
    for (const truck of fleetMap.trucksWithoutCoordinates) actions.push({ id: `mapping:${truck}`, kind: "mapping", priority: "watch", truck, title: "Tracker-to-truck mapping needs verification", detail: "GPS totals may exist, but this truck has no verified map coordinate.", actionLabel: "View live map" });
  }

  return actions.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.truck.localeCompare(b.truck, undefined, { numeric: true }) || a.title.localeCompare(b.title));
}
