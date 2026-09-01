import crypto from "node:crypto";
import type { ActionVerification } from "@/lib/platform/contracts";
import { getOpsRuntime } from "@/lib/runtime";
import {
  buildSearchKingsView,
  readLostLeadStore,
  saveLostLeadOverrideIfCurrent,
  type LostLeadReason,
  type LostLeadStatus,
  type LostLeadStore,
  type SearchKingsLead,
  type SearchKingsView,
} from "@/lib/searchkings";

export type SearchKingsControlMode = "live_control" | "preview_simulation";

export type SearchKingsRecoveryLead = {
  callId: string;
  callerName: string;
  calledAt: string;
  territory: string;
  city: string;
  source: string;
  score: number | null;
  summary: string;
  tags: string[];
  status: LostLeadStatus;
  reason: LostLeadReason;
  owner: string;
  nextAction: string;
  evidenceNote: string;
  franchiseContacted: boolean;
  potentialRevenue: number | null;
  matchedAppointment: {
    appointmentId: string;
    jkNumber: string;
    date: string;
    status: string;
    completed: boolean;
    realizedRevenue: number | null;
  } | null;
  observationKey: string;
  overrideUpdatedAt: string;
};

export type SearchKingsControlSnapshot = {
  date: string;
  mode: SearchKingsControlMode;
  source: "SearchKings Reports API + JunkWare appointment evidence";
  sourceObservedAt: string;
  rangeLabel: string;
  storeUpdatedAt: string;
  summary: {
    totalCalls: number;
    qualifiedCalls: number;
    lost: number;
    needsFollowUp: number;
    bookedOrRecovered: number;
    completedAttributedRevenue: number;
  };
  recoveryLeads: SearchKingsRecoveryLead[];
  authorityNotice: string;
  warning?: string;
};

export type SearchKingsRecoveryInput = {
  date: string;
  callId: string;
  status: "needs_follow_up" | "lost" | "unqualified";
  reason: LostLeadReason;
  owner: string;
  nextAction: string;
  evidenceNote: string;
  franchiseContacted: boolean;
  expectedSnapshotFetchedAt: string;
  expectedStoreUpdatedAt: string;
  expectedOverrideUpdatedAt: string;
  expectedObservationKey: string;
};

export type SearchKingsRecoveryReceipt = {
  mode: SearchKingsControlMode;
  callId: string;
  changed: boolean;
  verified: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

export type SearchKingsSnapshotReader = (date: string) => SearchKingsControlSnapshot;

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function redactContactDetails(value: unknown): string {
  return clean(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[contact removed]")
    .replace(/(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g, "[contact removed]");
}

export function searchKingsControlMode(): SearchKingsControlMode {
  return getOpsRuntime() === "MISSION_CONTROL" ? "live_control" : "preview_simulation";
}

function leadObservationKey(lead: SearchKingsLead, snapshotFetchedAt: string): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    snapshotFetchedAt,
    callId: lead.callId,
    calledAt: lead.calledAt,
    territory: lead.territory,
    score: lead.score,
    status: lead.status,
    reason: lead.reason,
    potentialRevenue: lead.potentialRevenue,
    matchedAppointment: lead.matchedAppointment ? {
      appointmentId: lead.matchedAppointment.appointmentId,
      jobId: lead.matchedAppointment.jobId,
      date: lead.matchedAppointment.date,
      completed: lead.matchedAppointment.completed,
      revenue: lead.matchedAppointment.revenue,
      status: lead.matchedAppointment.status,
    } : null,
    updatedAt: lead.updatedAt,
  })).digest("hex");
}

function recoveryPriority(left: SearchKingsRecoveryLead, right: SearchKingsRecoveryLead): number {
  const lost = Number(right.status === "lost") - Number(left.status === "lost");
  if (lost) return lost;
  const uncontacted = Number(left.franchiseContacted) - Number(right.franchiseContacted);
  if (uncontacted) return uncontacted;
  const value = (right.potentialRevenue ?? -1) - (left.potentialRevenue ?? -1);
  return value || right.calledAt.localeCompare(left.calledAt);
}

function controlLead(lead: SearchKingsLead, store: LostLeadStore, snapshotFetchedAt: string): SearchKingsRecoveryLead {
  const override = store.entries.find((entry) => entry.callId === lead.callId);
  return {
    callId: lead.callId,
    callerName: clean(lead.callerName) || "Unknown caller",
    calledAt: lead.calledAt,
    territory: clean(lead.territory),
    city: clean(lead.city),
    source: clean(lead.trackingLabel || lead.source || "SearchKings"),
    score: lead.score,
    summary: redactContactDetails(lead.summary),
    tags: lead.tags.map(redactContactDetails).filter(Boolean),
    status: lead.status,
    reason: lead.reason,
    owner: clean(override?.owner),
    nextAction: clean(override?.note),
    evidenceNote: clean(override?.evidenceNote),
    franchiseContacted: lead.franchiseContacted,
    potentialRevenue: lead.potentialRevenue,
    matchedAppointment: lead.matchedAppointment ? {
      appointmentId: lead.matchedAppointment.appointmentId,
      jkNumber: lead.matchedAppointment.jobId,
      date: lead.matchedAppointment.date,
      status: lead.matchedAppointment.status,
      completed: lead.matchedAppointment.completed,
      realizedRevenue: lead.matchedAppointment.completed ? lead.matchedAppointment.revenue : null,
    } : null,
    observationKey: leadObservationKey(lead, snapshotFetchedAt),
    overrideUpdatedAt: clean(override?.updatedAt),
  };
}

export function buildSearchKingsControlSnapshot(
  date: string,
  view: SearchKingsView,
  store: LostLeadStore = readLostLeadStore(),
): SearchKingsControlSnapshot {
  const snapshotFetchedAt = view.snapshot?.fetchedAt || "";
  const recoveryLeads = view.leads
    .filter((lead) => lead.status === "lost" || lead.status === "needs_follow_up")
    .map((lead) => controlLead(lead, store, snapshotFetchedAt))
    .sort(recoveryPriority);
  return {
    date,
    mode: searchKingsControlMode(),
    source: "SearchKings Reports API + JunkWare appointment evidence",
    sourceObservedAt: snapshotFetchedAt,
    rangeLabel: view.rangeLabel,
    storeUpdatedAt: store.updatedAt,
    summary: {
      totalCalls: view.totalCalls,
      qualifiedCalls: view.qualifiedCalls,
      lost: view.lostLeads,
      needsFollowUp: view.needsFollowUp,
      bookedOrRecovered: view.bookedJobs,
      completedAttributedRevenue: view.attributedRevenue,
    },
    recoveryLeads,
    authorityNotice: "SearchKings is the call source; JunkWare is authoritative for booking, completion, and realized revenue. This command records only an approval-gated OpsCenter recovery disposition. It never calls or messages a customer, changes SearchKings, or edits a JunkWare appointment.",
    ...(!view.available ? { warning: view.error || "A verified SearchKings snapshot is unavailable." } : {}),
  };
}

export function readSearchKingsControlSnapshot(date: string): SearchKingsControlSnapshot {
  return buildSearchKingsControlSnapshot(date, buildSearchKingsView(), readLostLeadStore());
}

export function prepareSearchKingsRecoveryInput(
  date: string,
  callId: string,
  draft: Pick<SearchKingsRecoveryInput, "status" | "reason" | "owner" | "nextAction" | "evidenceNote" | "franchiseContacted">,
  snapshotReader: SearchKingsSnapshotReader = readSearchKingsControlSnapshot,
): SearchKingsRecoveryInput {
  const snapshot = snapshotReader(date);
  const lead = snapshot.recoveryLeads.find((candidate) => candidate.callId === clean(callId));
  if (!lead) throw new Error("That call is not in the current verified SearchKings recovery queue.");
  return {
    date,
    callId: lead.callId,
    ...draft,
    expectedSnapshotFetchedAt: snapshot.sourceObservedAt,
    expectedStoreUpdatedAt: snapshot.storeUpdatedAt,
    expectedOverrideUpdatedAt: lead.overrideUpdatedAt,
    expectedObservationKey: lead.observationKey,
  };
}

function currentLead(input: SearchKingsRecoveryInput, snapshotReader: SearchKingsSnapshotReader): SearchKingsRecoveryLead {
  const snapshot = snapshotReader(input.date);
  if (snapshot.sourceObservedAt !== input.expectedSnapshotFetchedAt) {
    throw new Error("VERSION_CONFLICT: The SearchKings source snapshot changed after this request was prepared.");
  }
  if (snapshot.storeUpdatedAt !== input.expectedStoreUpdatedAt) {
    throw new Error("VERSION_CONFLICT: SearchKings recovery state changed after this request was prepared.");
  }
  const lead = snapshot.recoveryLeads.find((candidate) => candidate.callId === input.callId);
  if (!lead) throw new Error("The SearchKings call is no longer in the current recovery queue.");
  if (lead.observationKey !== input.expectedObservationKey || lead.overrideUpdatedAt !== input.expectedOverrideUpdatedAt) {
    throw new Error("VERSION_CONFLICT: SearchKings or JunkWare lead evidence changed after this request was prepared.");
  }
  return lead;
}

export async function executeSearchKingsRecovery(
  input: SearchKingsRecoveryInput,
  actorLabel = "Approved OpsCenter manager",
  snapshotReader: SearchKingsSnapshotReader = readSearchKingsControlSnapshot,
): Promise<SearchKingsRecoveryReceipt> {
  const lead = currentLead(input, snapshotReader);
  const mode = searchKingsControlMode();
  const evidence = {
    date: input.date,
    callId: input.callId,
    sourceObservedAt: input.expectedSnapshotFetchedAt,
    sourceObservationKey: input.expectedObservationKey,
    priorStatus: lead.status,
    approvedStatus: input.status,
    junkWareAppointmentId: lead.matchedAppointment?.appointmentId || "",
  };
  if (mode === "preview_simulation") {
    return {
      mode,
      callId: input.callId,
      changed: false,
      verified: true,
      summary: "Preview simulation verified; no SearchKings recovery, customer contact, SearchKings, or JunkWare state was changed.",
      evidence,
    };
  }
  const saved = saveLostLeadOverrideIfCurrent({
    callId: input.callId,
    status: input.status,
    reason: input.reason,
    note: input.nextAction,
    owner: input.owner,
    evidenceNote: input.evidenceNote,
    franchiseContacted: input.franchiseContacted,
    updatedBy: actorLabel,
  }, {
    storeUpdatedAt: input.expectedStoreUpdatedAt,
    entryUpdatedAt: input.expectedOverrideUpdatedAt,
  });
  return {
    mode,
    callId: input.callId,
    changed: true,
    verified: true,
    summary: "SearchKings recovery disposition verified in OpsCenter recovery state.",
    evidence: { ...evidence, updatedAt: saved.updatedAt },
  };
}

export async function verifySearchKingsRecovery(
  receipt: SearchKingsRecoveryReceipt,
  input: SearchKingsRecoveryInput,
): Promise<ActionVerification> {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const saved = readLostLeadStore().entries.find((entry) => entry.callId === input.callId);
  if (
    !saved
    || saved.status !== input.status
    || saved.reason !== input.reason
    || saved.owner !== input.owner
    || saved.note !== input.nextAction
    || saved.evidenceNote !== input.evidenceNote
    || saved.franchiseContacted !== input.franchiseContacted
  ) {
    return { outcome: "mismatch", summary: "The recovery record does not match the approved disposition, owner, next action, evidence, and contact flag." };
  }
  return {
    outcome: "verified",
    verifiedAt: saved.updatedAt,
    summary: receipt.summary,
    evidence: { ...receipt.evidence, updatedAt: saved.updatedAt },
  };
}
