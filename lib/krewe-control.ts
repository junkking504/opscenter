import type { ActionVerification } from "@/lib/platform/contracts";
import { buildCrewCallInPlan, type CrewCallInCandidate } from "@/lib/crew-call-in-recommendations";
import { workedOrAttributedToJobToday } from "@/lib/crew-attendance";
import {
  kreweAvailabilityRecord,
  readKreweControlStore,
  saveKreweControlRecord,
  type KreweAvailabilityRecord,
  type KreweAvailabilityStatus,
  type KreweCallInRole,
} from "@/lib/krewe-control-store";
import { normalizeEmployeeKey } from "@/lib/manual-bonuses";
import { crewRows, readMetrics, type AnyRecord } from "@/lib/opsData";
import { getOpsRuntime } from "@/lib/runtime";

export type KreweControlMode = "live_control" | "preview_simulation";

export type KreweControlPerson = {
  name: string;
  normalizedName: string;
  todayStatus: "worked_or_attributed" | "roster_only";
  clockIn: string;
  clockOut: string;
  truck: string;
  recommendedForCallIn: boolean;
  suggestedRole: "Driver" | "Crew" | "";
  recommendationReason: string;
  overtimeRisk: boolean;
  availability: Pick<KreweAvailabilityRecord, "status" | "role" | "note" | "updatedAt"> | null;
};

export type KreweControlSnapshot = {
  date: string;
  targetDate: string;
  mode: KreweControlMode;
  source: "Daily metrics + JunkWare schedule + OpsCenter human confirmations";
  sourceObservedAt: string;
  storeUpdatedAt: string;
  scheduleUpdatedAt: string;
  scheduleAvailable: boolean;
  people: KreweControlPerson[];
  summary: {
    roster: number;
    workedToday: number;
    clockedInNow: number;
    tomorrowAppointments: number;
    requiredHeadcount: number;
    alreadyAssigned: number;
    callInNeeded: number;
    availableResponses: number;
    unavailableResponses: number;
    committedCallIns: number;
  };
  recommendations: CrewCallInCandidate[];
  alternates: CrewCallInCandidate[];
  warning?: string;
  authorityNotice: string;
};

export type KreweAvailabilityInput = {
  employeeName: string;
  targetDate: string;
  status: "available" | "unavailable";
  note: string;
  expectedStoreUpdatedAt: string;
  expectedRecordUpdatedAt: string;
};

export type KreweScheduleCallInInput = {
  employeeName: string;
  baseDate: string;
  targetDate: string;
  role: Exclude<KreweCallInRole, "">;
  note: string;
  availabilityConfirmed: true;
  expectedScheduleUpdatedAt: string;
  expectedStoreUpdatedAt: string;
  expectedRecordUpdatedAt: string;
};

export type KreweExecutionReceipt = {
  mode: KreweControlMode;
  recordId: string;
  employeeName: string;
  targetDate: string;
  changed: boolean;
  verified: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function displayName(row: AnyRecord): string {
  const raw = String(row?.name || row?.employee_name || row?.employee || row?.crew_member || "").trim();
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  return (parts.length === 2 ? `${parts[1]} ${parts[0]}` : raw).replace(/\s+/g, " ").trim();
}

function firstText(row: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = String(row?.[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function truckLabel(row: AnyRecord): string {
  const direct = firstText(row, ["truck", "assigned_truck", "truck_name"]);
  if (direct) return direct;
  const trucks = Array.isArray(row?.trucks) ? row.trucks.map(String).filter(Boolean) : [];
  return trucks.join(", ");
}

export function kreweControlMode(): KreweControlMode {
  return getOpsRuntime() === "MISSION_CONTROL" ? "live_control" : "preview_simulation";
}

function recommendationMap(candidates: CrewCallInCandidate[]): Map<string, CrewCallInCandidate> {
  return new Map(candidates.map((candidate) => [normalizeEmployeeKey(candidate.name), candidate]));
}

export function readKreweControlSnapshot(date: string): KreweControlSnapshot {
  const metrics = readMetrics(date);
  const rosterRows = crewRows(metrics);
  const plan = buildCrewCallInPlan(date);
  const store = readKreweControlStore();
  const targetRecords = store.records.filter((record) => record.targetDate === plan.targetDate);
  const recommended = recommendationMap(plan.recommendations);
  const alternates = recommendationMap(plan.alternates);
  const rows = new Map<string, { name: string; row: AnyRecord | null }>();
  for (const row of rosterRows) {
    const name = displayName(row);
    const key = normalizeEmployeeKey(name);
    if (key) rows.set(key, { name, row });
  }
  for (const candidate of [...plan.recommendations, ...plan.alternates]) {
    const key = normalizeEmployeeKey(candidate.name);
    if (key && !rows.has(key)) rows.set(key, { name: candidate.name, row: null });
  }
  for (const record of targetRecords) {
    if (!rows.has(record.normalizedEmployeeName)) {
      rows.set(record.normalizedEmployeeName, { name: record.employeeName, row: null });
    }
  }
  const people = Array.from(rows, ([normalizedName, value]): KreweControlPerson => {
    const row = value.row || {};
    const candidate = recommended.get(normalizedName) || alternates.get(normalizedName) || null;
    const record = targetRecords.find((current) => current.normalizedEmployeeName === normalizedName) || null;
    const clockIn = firstText(row, ["clock_in", "time_in", "clockIn", "timeIn", "clock_in_display"]);
    const clockOut = firstText(row, ["clock_out", "time_out", "clockOut", "timeOut", "clock_out_display"]);
    return {
      name: value.name,
      normalizedName,
      todayStatus: workedOrAttributedToJobToday(row) ? "worked_or_attributed" : "roster_only",
      clockIn,
      clockOut,
      truck: truckLabel(row),
      recommendedForCallIn: recommended.has(normalizedName),
      suggestedRole: candidate?.suggestedRole || "",
      recommendationReason: candidate?.reason || "",
      overtimeRisk: Boolean(candidate?.overtimeRisk),
      availability: record ? {
        status: record.status,
        role: record.role,
        note: record.note,
        updatedAt: record.updatedAt,
      } : null,
    };
  }).sort((left, right) =>
    Number(right.recommendedForCallIn) - Number(left.recommendedForCallIn)
    || left.name.localeCompare(right.name));
  const workedToday = people.filter((person) => person.todayStatus === "worked_or_attributed").length;
  const clockedInNow = people.filter((person) => person.clockIn && !person.clockOut).length;
  const sourceObservedAt = [
    String(metrics?.generated_at || ""),
    plan.scheduleUpdatedAt || "",
    store.updatedAt,
  ].filter(Boolean).sort().at(-1) || "";
  return {
    date,
    targetDate: plan.targetDate,
    mode: kreweControlMode(),
    source: "Daily metrics + JunkWare schedule + OpsCenter human confirmations",
    sourceObservedAt,
    storeUpdatedAt: store.updatedAt,
    scheduleUpdatedAt: plan.scheduleUpdatedAt || "",
    scheduleAvailable: plan.scheduleAvailable,
    people,
    summary: {
      roster: rosterRows.length,
      workedToday,
      clockedInNow,
      tomorrowAppointments: plan.appointmentCount,
      requiredHeadcount: plan.requiredHeadcount,
      alreadyAssigned: plan.alreadyAssignedHeadcount,
      callInNeeded: plan.callInCount,
      availableResponses: targetRecords.filter((record) => record.status === "available").length,
      unavailableResponses: targetRecords.filter((record) => record.status === "unavailable").length,
      committedCallIns: targetRecords.filter((record) => record.status === "called_in").length,
    },
    recommendations: plan.recommendations,
    alternates: plan.alternates,
    warning: plan.scheduleAvailable ? undefined : plan.note,
    authorityNotice: "Availability is a human-confirmed OpsCenter record. A committed call-in requires separate approval and does not message the employee or assign a JunkWare job.",
  };
}

function currentRecord(
  employeeName: string,
  targetDate: string,
  expectedStoreUpdatedAt: string,
  expectedRecordUpdatedAt: string,
): KreweAvailabilityRecord | null {
  const store = readKreweControlStore();
  if (store.updatedAt !== expectedStoreUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Krewe control state changed after this request was prepared.");
  }
  const record = store.records.find((candidate) =>
    candidate.targetDate === targetDate
    && candidate.normalizedEmployeeName === normalizeEmployeeKey(employeeName)) || null;
  if (String(record?.updatedAt || "") !== expectedRecordUpdatedAt) {
    throw new Error("VERSION_CONFLICT: The employee availability record changed after this request was prepared.");
  }
  return record;
}

export async function executeKreweAvailability(
  input: KreweAvailabilityInput,
  actorLabel = "Authenticated OpsCenter user",
): Promise<KreweExecutionReceipt> {
  const current = currentRecord(
    input.employeeName,
    input.targetDate,
    input.expectedStoreUpdatedAt,
    input.expectedRecordUpdatedAt,
  );
  if (current?.status === "called_in") {
    throw new Error("A committed call-in cannot be replaced by a direct availability update.");
  }
  const mode = kreweControlMode();
  if (mode === "preview_simulation") {
    return {
      mode,
      recordId: current?.recordId || "preview-simulation",
      employeeName: input.employeeName,
      targetDate: input.targetDate,
      changed: true,
      verified: true,
      summary: "Preview simulation verified; no Krewe availability response was changed.",
      evidence: { targetDate: input.targetDate, requestedStatus: input.status },
    };
  }
  const record = saveKreweControlRecord({
    ...input,
    role: "",
    updatedBy: actorLabel,
    action: "availability_recorded",
  }, {
    storeUpdatedAt: input.expectedStoreUpdatedAt,
    recordUpdatedAt: input.expectedRecordUpdatedAt,
  });
  return {
    mode,
    recordId: record.recordId,
    employeeName: record.employeeName,
    targetDate: record.targetDate,
    changed: true,
    verified: true,
    summary: `${record.employeeName} availability verified for ${record.targetDate}.`,
    evidence: { recordId: record.recordId, targetDate: record.targetDate, status: record.status, updatedAt: record.updatedAt },
  };
}

export async function executeKreweScheduleCallIn(
  input: KreweScheduleCallInInput,
  actorLabel = "Approved OpsCenter manager",
): Promise<KreweExecutionReceipt> {
  const plan = buildCrewCallInPlan(input.baseDate);
  if (!plan.scheduleAvailable || !plan.scheduleUpdatedAt) {
    throw new Error("Tomorrow’s authoritative JunkWare schedule is not available.");
  }
  if (plan.targetDate !== input.targetDate || plan.scheduleUpdatedAt !== input.expectedScheduleUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Tomorrow’s JunkWare schedule changed after this request was prepared.");
  }
  const current = currentRecord(
    input.employeeName,
    input.targetDate,
    input.expectedStoreUpdatedAt,
    input.expectedRecordUpdatedAt,
  );
  if (current?.status === "unavailable") throw new Error("The employee is currently recorded as unavailable.");
  if (current?.status === "called_in") throw new Error("The employee already has a committed call-in for this date.");
  const mode = kreweControlMode();
  if (mode === "preview_simulation") {
    return {
      mode,
      recordId: current?.recordId || "preview-simulation",
      employeeName: input.employeeName,
      targetDate: input.targetDate,
      changed: true,
      verified: true,
      summary: "Preview simulation verified; no Krewe call-in commitment was changed.",
      evidence: { targetDate: input.targetDate, role: input.role, availabilityConfirmed: true },
    };
  }
  const record = saveKreweControlRecord({
    employeeName: input.employeeName,
    targetDate: input.targetDate,
    status: "called_in",
    role: input.role,
    note: input.note,
    updatedBy: actorLabel,
    action: "call_in_scheduled",
  }, {
    storeUpdatedAt: input.expectedStoreUpdatedAt,
    recordUpdatedAt: input.expectedRecordUpdatedAt,
  });
  return {
    mode,
    recordId: record.recordId,
    employeeName: record.employeeName,
    targetDate: record.targetDate,
    changed: true,
    verified: true,
    summary: `${record.employeeName} call-in commitment verified for ${record.targetDate}.`,
    evidence: { recordId: record.recordId, targetDate: record.targetDate, status: record.status, role: record.role, updatedAt: record.updatedAt },
  };
}

export async function verifyKreweAvailability(
  receipt: KreweExecutionReceipt,
  input: KreweAvailabilityInput,
): Promise<ActionVerification> {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const record = kreweAvailabilityRecord(input.targetDate, input.employeeName);
  if (!record || record.recordId !== receipt.recordId || record.status !== input.status || record.note !== input.note) {
    return { outcome: "mismatch", summary: "The Krewe availability record does not match the requested response." };
  }
  return { outcome: "verified", verifiedAt: record.updatedAt, summary: receipt.summary, evidence: receipt.evidence };
}

export async function verifyKreweScheduleCallIn(
  receipt: KreweExecutionReceipt,
  input: KreweScheduleCallInInput,
): Promise<ActionVerification> {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const record = kreweAvailabilityRecord(input.targetDate, input.employeeName);
  if (
    !record
    || record.recordId !== receipt.recordId
    || record.status !== "called_in"
    || record.role !== input.role
    || record.note !== input.note
  ) {
    return { outcome: "mismatch", summary: "The Krewe call-in record does not match the approved commitment." };
  }
  return { outcome: "verified", verifiedAt: record.updatedAt, summary: receipt.summary, evidence: receipt.evidence };
}
