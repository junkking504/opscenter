import type { ActionVerification } from "@/lib/platform/contracts";
import { buildFleetMaintenanceActions, type FleetMaintenanceAction } from "@/lib/fleet-maintenance-actions";
import { readFleetChecklistStore } from "@/lib/fleet-checklists";
import { readFleetChecklistTemplateStore } from "@/lib/fleet-checklist-templates";
import { readFleetIssueStore, upsertFleetIssue, type FleetIssue } from "@/lib/fleet-issues";
import { readFleetMaintenanceStore } from "@/lib/fleet-maintenance";
import { buildFleetMapPayload } from "@/lib/fleet-map";
import { readLatestLinxupVehicleInventory } from "@/lib/linxup-vehicle-inventory";
import { getOpsRuntime } from "@/lib/runtime";

export type FleetControlMode = "live_control" | "preview_simulation";
export type FleetReadiness = "out_of_service" | "action_required" | "no_active_hold";

export type FleetControlIssue = Pick<
  FleetIssue,
  "issueId" | "title" | "severity" | "status" | "owner" | "dueDate" | "updatedAt"
>;

export type FleetControlTruck = {
  truck: string;
  readiness: FleetReadiness;
  activeIssueCount: number;
  blockingIssues: FleetControlIssue[];
  topAction: FleetMaintenanceAction | null;
  gpsFreshness: string;
  lastGpsUpdate: string;
  hasVerifiedCoordinate: boolean;
};

export type FleetControlSnapshot = {
  date: string;
  mode: FleetControlMode;
  source: "OpsCenter Fleet repair records";
  sourceObservedAt: string;
  storeUpdatedAt: string;
  trucks: FleetControlTruck[];
  summary: {
    trucks: number;
    outOfService: number;
    actionRequired: number;
    activeRepairs: number;
    incompleteInspections: number;
  };
  warning?: string;
};

export type FleetOutOfServiceInput = {
  truck: string;
  reason: string;
  expectedStoreUpdatedAt: string;
};

export type FleetReturnToServiceInput = {
  truck: string;
  issueId: string;
  resolution: string;
  expectedStoreUpdatedAt: string;
  expectedIssueUpdatedAt: string;
};

export type FleetExecutionReceipt = {
  mode: FleetControlMode;
  truck: string;
  issueId: string;
  changed: boolean;
  verified: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

export function normalizeFleetControlTruck(value: unknown): string {
  const match = String(value || "").trim().match(/truck\s*#?\s*(\d+)/i);
  return match ? `Truck# ${match[1]}` : "";
}

export function fleetControlMode(): FleetControlMode {
  return getOpsRuntime() === "MISSION_CONTROL" ? "live_control" : "preview_simulation";
}

function activeIssuesForTruck(issues: FleetIssue[], truck: string): FleetIssue[] {
  return issues.filter((issue) => issue.truck === truck && issue.status !== "resolved");
}

function blockingIssuesForTruck(issues: FleetIssue[], truck: string): FleetIssue[] {
  return activeIssuesForTruck(issues, truck).filter((issue) => issue.severity === "out_of_service");
}

function controlIssue(issue: FleetIssue): FleetControlIssue {
  return {
    issueId: issue.issueId,
    title: issue.title,
    severity: issue.severity,
    status: issue.status,
    owner: issue.owner,
    dueDate: issue.dueDate,
    updatedAt: issue.updatedAt,
  };
}

export function readFleetControlSnapshot(date: string): FleetControlSnapshot {
  const issueStore = readFleetIssueStore();
  const checklistStore = readFleetChecklistStore();
  const templateStore = readFleetChecklistTemplateStore();
  const maintenanceStore = readFleetMaintenanceStore();
  const inventory = readLatestLinxupVehicleInventory();
  const fleetMap = buildFleetMapPayload(date);
  const truckOptions = Array.from(new Set([
    ...inventory.vehicles.map((vehicle) => vehicle.truck),
    ...maintenanceStore.records.map((record) => record.truck),
    ...checklistStore.entries.map((entry) => entry.truck),
    ...issueStore.issues.map((issue) => issue.truck),
    ...(fleetMap?.trucks || []).map((truck) => truck.truck),
    ...(fleetMap?.trucksWithoutCoordinates || []),
  ].map(normalizeFleetControlTruck).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const actions = buildFleetMaintenanceActions({
    today: date,
    truckOptions,
    entries: checklistStore.entries,
    customizations: templateStore.customizations,
    issues: issueStore.issues,
    fleetMap,
  });
  const trucks = truckOptions.map((truck): FleetControlTruck => {
    const activeIssues = activeIssuesForTruck(issueStore.issues, truck);
    const blockingIssues = activeIssues.filter((issue) => issue.severity === "out_of_service");
    const topAction = actions.find((action) => action.truck === truck) || null;
    const mapRecord = fleetMap?.trucks.find((record) => record.truck === truck);
    const readiness: FleetReadiness = blockingIssues.length
      ? "out_of_service"
      : topAction && topAction.priority !== "watch" ? "action_required" : "no_active_hold";
    return {
      truck,
      readiness,
      activeIssueCount: activeIssues.length,
      blockingIssues: blockingIssues.map(controlIssue),
      topAction,
      gpsFreshness: mapRecord?.freshnessLabel || "No verified tracker state",
      lastGpsUpdate: mapRecord?.lastGpsUpdate || "",
      hasVerifiedCoordinate: Boolean(mapRecord?.hasCoordinates),
    };
  });
  const sourceObservedAt = [
    issueStore.updatedAt,
    checklistStore.updatedAt,
    templateStore.updatedAt,
    maintenanceStore.updatedAt,
    inventory.retrievedAt,
    fleetMap?.lastUpdatedAt || "",
  ].filter(Boolean).sort().at(-1) || "";
  return {
    date,
    mode: fleetControlMode(),
    source: "OpsCenter Fleet repair records",
    sourceObservedAt,
    storeUpdatedAt: issueStore.updatedAt,
    trucks,
    summary: {
      trucks: trucks.length,
      outOfService: trucks.filter((truck) => truck.readiness === "out_of_service").length,
      actionRequired: trucks.filter((truck) => truck.readiness === "action_required").length,
      activeRepairs: issueStore.issues.filter((issue) => issue.status !== "resolved").length,
      incompleteInspections: new Set(actions.filter((action) => action.kind === "checklist").map((action) => action.truck)).size,
    },
    warning: trucks.length ? undefined : "No authoritative Fleet vehicle inventory is available.",
  };
}

function currentStore(expectedStoreUpdatedAt: string) {
  const store = readFleetIssueStore();
  if (store.updatedAt !== expectedStoreUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Fleet repair state changed after this request was prepared.");
  }
  return store;
}

export async function executeFleetOutOfService(input: FleetOutOfServiceInput): Promise<FleetExecutionReceipt> {
  const store = currentStore(input.expectedStoreUpdatedAt);
  if (blockingIssuesForTruck(store.issues, input.truck).length) {
    throw new Error("The truck already has an active out-of-service repair.");
  }
  const mode = fleetControlMode();
  if (mode === "preview_simulation") {
    return {
      mode,
      truck: input.truck,
      issueId: "preview-simulation",
      changed: true,
      verified: true,
      summary: "Preview simulation verified; no Fleet repair or truck hold was changed.",
      evidence: { truck: input.truck, requestedState: "out_of_service", priorBlockingIssues: 0 },
    };
  }
  const issue = upsertFleetIssue({
    truck: input.truck,
    title: input.reason,
    description: "Out-of-service hold created through OpsBot Control.",
    severity: "out_of_service",
    status: "open",
  }, { storeUpdatedAt: input.expectedStoreUpdatedAt });
  if (!issue) throw new Error("The out-of-service repair could not be created.");
  return {
    mode,
    truck: input.truck,
    issueId: issue.issueId,
    changed: true,
    verified: true,
    summary: `${input.truck} out-of-service hold verified in Fleet repair records.`,
    evidence: { issueId: issue.issueId, severity: issue.severity, status: issue.status, updatedAt: issue.updatedAt },
  };
}

export async function executeFleetReturnToService(input: FleetReturnToServiceInput): Promise<FleetExecutionReceipt> {
  const store = currentStore(input.expectedStoreUpdatedAt);
  const blockers = blockingIssuesForTruck(store.issues, input.truck);
  if (blockers.length !== 1) {
    throw new Error(blockers.length
      ? "Return to service requires every other out-of-service repair to be resolved first."
      : "The truck no longer has an active out-of-service repair.");
  }
  const blocker = blockers[0];
  if (blocker.issueId !== input.issueId || blocker.updatedAt !== input.expectedIssueUpdatedAt) {
    throw new Error("VERSION_CONFLICT: The blocking Fleet repair changed after this request was prepared.");
  }
  const mode = fleetControlMode();
  if (mode === "preview_simulation") {
    return {
      mode,
      truck: input.truck,
      issueId: blocker.issueId,
      changed: true,
      verified: true,
      summary: "Preview simulation verified; no Fleet repair or return-to-service state was changed.",
      evidence: { truck: input.truck, issueId: blocker.issueId, requestedState: "no_active_hold" },
    };
  }
  const issue = upsertFleetIssue({
    issueId: blocker.issueId,
    status: "resolved",
    resolution: input.resolution,
  }, {
    storeUpdatedAt: input.expectedStoreUpdatedAt,
    issueUpdatedAt: input.expectedIssueUpdatedAt,
  });
  if (!issue) throw new Error("The Fleet repair could not be resolved.");
  return {
    mode,
    truck: input.truck,
    issueId: issue.issueId,
    changed: true,
    verified: true,
    summary: `${input.truck} return to service verified in Fleet repair records.`,
    evidence: { issueId: issue.issueId, status: issue.status, resolvedAt: issue.resolvedAt, updatedAt: issue.updatedAt },
  };
}

export async function verifyFleetOutOfService(
  receipt: FleetExecutionReceipt,
  input: FleetOutOfServiceInput,
): Promise<ActionVerification> {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const issue = readFleetIssueStore().issues.find((candidate) => candidate.issueId === receipt.issueId);
  if (!issue || issue.truck !== input.truck || issue.status === "resolved" || issue.severity !== "out_of_service") {
    return { outcome: "mismatch", summary: "The Fleet repair record does not contain the approved out-of-service hold." };
  }
  return {
    outcome: "verified",
    verifiedAt: issue.updatedAt,
    summary: receipt.summary,
    evidence: { issueId: issue.issueId, severity: issue.severity, status: issue.status, updatedAt: issue.updatedAt },
  };
}

export async function verifyFleetReturnToService(
  receipt: FleetExecutionReceipt,
  input: FleetReturnToServiceInput,
): Promise<ActionVerification> {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const store = readFleetIssueStore();
  const issue = store.issues.find((candidate) => candidate.issueId === input.issueId);
  const blockers = blockingIssuesForTruck(store.issues, input.truck);
  if (!issue || issue.status !== "resolved" || issue.resolution !== input.resolution || blockers.length) {
    return {
      outcome: "mismatch",
      summary: blockers.length
        ? "The repair was updated, but another out-of-service hold still blocks the truck."
        : "The Fleet repair record does not match the approved return-to-service outcome.",
      evidence: { remainingBlockingIssueIds: blockers.map((candidate) => candidate.issueId) },
    };
  }
  return {
    outcome: "verified",
    verifiedAt: issue.resolvedAt || issue.updatedAt,
    summary: receipt.summary,
    evidence: { issueId: issue.issueId, status: issue.status, resolvedAt: issue.resolvedAt },
  };
}
