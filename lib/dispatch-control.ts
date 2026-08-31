import path from "node:path";
import type { ActionVerification } from "@/lib/platform/contracts";
import type { AnyRecord } from "@/lib/opsData";
import { classifyJunkwareAssignmentFailure } from "@/lib/junkware-assignment-failure";
import { readVerifiedJunkwareScheduleSnapshot } from "@/lib/junkware-fast-schedule";
import { readJobCallAheadStatuses, saveJobCallAheadStatus, type JobCallAheadStatus } from "@/lib/job-call-ahead";
import {
  readJobRouteAssignmentOverrides,
  saveJobRouteAssignment,
  withJunkwareAppointmentSyncLock,
} from "@/lib/job-route-assignments";
import { syncJunkwareTruckAssignment } from "@/lib/junkware-truck-assignment";
import { getOpsRuntime } from "@/lib/runtime";

export type DispatchControlMode = "live_control" | "preview_simulation";

export type DispatchControlAppointment = {
  appointmentId: string;
  jobKey: string;
  jkNumber: string;
  customerName: string;
  appointmentTime: string;
  appointmentType: string;
  status: string;
  territory: string;
  sourceTruck: string;
  effectiveTruck: string;
  sourceObservedAt: string;
  routeUpdatedAt: string;
  callAheadStatus: JobCallAheadStatus | "";
};

export type DispatchControlSnapshot = {
  date: string;
  mode: DispatchControlMode;
  source: "JunkWare verified schedule";
  sourceObservedAt: string;
  appointments: DispatchControlAppointment[];
  trucks: string[];
  warning?: string;
};

export type DispatchAssignmentInput = {
  date: string;
  appointmentId: string;
  jobKey: string;
  truck: string;
  expectedSourceTruck: string;
  expectedRouteUpdatedAt: string;
  sourceObservedAt: string;
};

export type DispatchCallAheadInput = {
  date: string;
  appointmentId: string;
  jobKey: string;
  status: JobCallAheadStatus;
  expectedStatus: JobCallAheadStatus | "";
  sourceObservedAt: string;
};

export type DispatchExecutionReceipt = {
  mode: DispatchControlMode;
  appointmentId: string;
  changed: boolean;
  verified: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

const OPSBOT_DATA_DIR = String(process.env.OPSBOT_DATA_DIR || "").trim()
  || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data");

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function first(row: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = clean(row[key]);
    if (value) return value;
  }
  return "";
}

export function normalizeDispatchTruck(value: unknown): string {
  const match = clean(value).match(/truck\s*#?\s*([1-9])/i);
  return match ? `Truck ${match[1]}` : "";
}

function closedOrCancelled(row: AnyRecord): boolean {
  const status = first(row, ["final_status", "job_status", "status"]).toLowerCase();
  return /complete|closed|paid|cancel/.test(status);
}

function dispatchWritesAllowed(): boolean {
  return getOpsRuntime() === "MISSION_CONTROL";
}

export function dispatchControlMode(): DispatchControlMode {
  return dispatchWritesAllowed() ? "live_control" : "preview_simulation";
}

export function readDispatchControlSnapshot(date: string): DispatchControlSnapshot {
  const mode = dispatchControlMode();
  const snapshot = readVerifiedJunkwareScheduleSnapshot(OPSBOT_DATA_DIR, date);
  if (!snapshot) {
    return {
      date,
      mode,
      source: "JunkWare verified schedule",
      sourceObservedAt: "",
      appointments: [],
      trucks: Array.from({ length: 9 }, (_, index) => `Truck ${index + 1}`),
      warning: "A complete verified JunkWare schedule is unavailable for this date.",
    };
  }

  const routeOverrides = readJobRouteAssignmentOverrides(date);
  const callAhead = readJobCallAheadStatuses();
  const appointments = snapshot.appointments
    .filter((row) => !closedOrCancelled(row))
    .map((row): DispatchControlAppointment | null => {
      const appointmentId = first(row, ["appt_id", "appointment_id", "appointmentId"]);
      if (!/^\d{1,12}$/.test(appointmentId)) return null;
      const jobKey = `appt:${appointmentId}`;
      const override = routeOverrides.get(jobKey);
      const sourceTruck = normalizeDispatchTruck(first(row, ["truck", "assigned_truck", "truck_number"]));
      return {
        appointmentId,
        jobKey,
        jkNumber: first(row, ["job_id", "jk_number", "job_number"]) || `Appointment ${appointmentId}`,
        customerName: first(row, ["customer_name", "customer", "name"]),
        appointmentTime: first(row, ["appointment_time", "scheduled_time", "time_window"]) || "Time unavailable",
        appointmentType: first(row, ["appointment_type", "type"]),
        status: first(row, ["final_status", "job_status", "status"]),
        territory: first(row, ["normalized_territory", "territory", "source_territory", "market"]),
        sourceTruck,
        effectiveTruck: override?.truck || sourceTruck,
        sourceObservedAt: snapshot.scrapedAt,
        routeUpdatedAt: override?.updatedAt || "",
        callAheadStatus: callAhead.get(`${date}|${jobKey}`) || "",
      };
    })
    .filter((appointment): appointment is DispatchControlAppointment => Boolean(appointment))
    .sort((left, right) => left.appointmentTime.localeCompare(right.appointmentTime)
      || left.jkNumber.localeCompare(right.jkNumber, undefined, { numeric: true }));
  const trucks = new Set(Array.from({ length: 9 }, (_, index) => `Truck ${index + 1}`));
  for (const appointment of appointments) {
    if (appointment.sourceTruck) trucks.add(appointment.sourceTruck);
    if (appointment.effectiveTruck) trucks.add(appointment.effectiveTruck);
  }
  return {
    date,
    mode,
    source: "JunkWare verified schedule",
    sourceObservedAt: snapshot.scrapedAt,
    appointments,
    trucks: Array.from(trucks).sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
  };
}

function currentAppointment(input: { date: string; appointmentId: string }): DispatchControlAppointment {
  const appointment = readDispatchControlSnapshot(input.date).appointments
    .find((candidate) => candidate.appointmentId === input.appointmentId);
  if (!appointment) throw new Error("The dispatch appointment is not present in the current verified schedule.");
  return appointment;
}

export async function executeDispatchAssignment(input: DispatchAssignmentInput): Promise<DispatchExecutionReceipt> {
  const current = currentAppointment(input);
  if (current.jobKey !== input.jobKey) throw new Error("Dispatch job identity mismatch.");
  if (current.sourceTruck !== input.expectedSourceTruck || current.routeUpdatedAt !== input.expectedRouteUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Dispatch assignment changed after this request was prepared.");
  }
  const mode = dispatchControlMode();
  if (mode === "preview_simulation") {
    return {
      mode,
      appointmentId: input.appointmentId,
      changed: current.effectiveTruck !== input.truck,
      verified: true,
      summary: "Preview simulation verified; no OpsCenter assignment or JunkWare appointment was changed.",
      evidence: { previousTruck: current.effectiveTruck, requestedTruck: input.truck, sourceObservedAt: current.sourceObservedAt },
    };
  }

  const pending = saveJobRouteAssignment({
    date: input.date,
    jobKey: input.jobKey,
    truck: input.truck,
    appointmentId: input.appointmentId,
    junkwareSyncStatus: "pending",
    expectedUpdatedAt: input.expectedRouteUpdatedAt || undefined,
  });
  if (!pending) throw new Error("VERSION_CONFLICT: The assignment changed before it could be saved.");

  try {
    const junkware = await withJunkwareAppointmentSyncLock(input.appointmentId, () => syncJunkwareTruckAssignment({
      appointmentId: input.appointmentId,
      truck: input.truck,
    }));
    const verified = saveJobRouteAssignment({
      date: input.date,
      jobKey: input.jobKey,
      truck: input.truck,
      appointmentId: input.appointmentId,
      junkwareVerifiedAt: junkware.verifiedAt,
      junkwareSyncStatus: "verified",
      expectedUpdatedAt: pending.updatedAt,
    });
    if (!verified) throw new Error("VERSION_CONFLICT: The assignment changed during JunkWare verification.");
    return {
      mode,
      appointmentId: input.appointmentId,
      changed: junkware.changed,
      verified: true,
      summary: `Truck assignment verified in JunkWare as ${input.truck || "unassigned"}.`,
      evidence: { truck: input.truck, verifiedAt: junkware.verifiedAt, routeUpdatedAt: verified.updatedAt },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "JunkWare could not verify the assignment.";
    const status = classifyJunkwareAssignmentFailure(error);
    saveJobRouteAssignment({
      date: input.date,
      jobKey: input.jobKey,
      truck: input.truck,
      appointmentId: input.appointmentId,
      junkwareSyncStatus: status,
      junkwareSyncError: detail,
      expectedUpdatedAt: pending.updatedAt,
    });
    if (status === "manual_correction") throw new Error(`JunkWare rejected the assignment: ${detail}`);
    return {
      mode,
      appointmentId: input.appointmentId,
      changed: true,
      verified: false,
      summary: "The assignment is saved in OpsCenter and awaiting JunkWare verification.",
      evidence: { truck: input.truck, pending: true },
    };
  }
}

export function verifyDispatchAssignment(receipt: DispatchExecutionReceipt, input: DispatchAssignmentInput): ActionVerification {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const record = readJobRouteAssignmentOverrides(input.date).get(input.jobKey);
  if (!record) return { outcome: "mismatch", summary: "The OpsCenter dispatch assignment is missing." };
  if (record.truck !== input.truck) {
    return { outcome: "mismatch", summary: "The OpsCenter assignment no longer matches the approved truck.", evidence: { truck: record.truck } };
  }
  if (record.junkwareSyncStatus !== "verified" || !record.junkwareVerifiedAt) {
    return { outcome: "pending", summary: "The assignment is still awaiting authoritative JunkWare verification.", evidence: { syncStatus: record.junkwareSyncStatus || "pending" } };
  }
  return {
    outcome: "verified",
    verifiedAt: record.junkwareVerifiedAt,
    summary: `Truck assignment verified in JunkWare as ${input.truck || "unassigned"}.`,
    evidence: { truck: record.truck, routeUpdatedAt: record.updatedAt },
  };
}

export function executeDispatchCallAhead(input: DispatchCallAheadInput): DispatchExecutionReceipt {
  const current = currentAppointment(input);
  if (current.jobKey !== input.jobKey) throw new Error("Dispatch job identity mismatch.");
  if (current.callAheadStatus !== input.expectedStatus) {
    throw new Error("VERSION_CONFLICT: Call-ahead status changed after this request was prepared.");
  }
  const mode = dispatchControlMode();
  if (mode === "preview_simulation") {
    return {
      mode,
      appointmentId: input.appointmentId,
      changed: current.callAheadStatus !== input.status,
      verified: true,
      summary: "Preview simulation verified; no shared call-ahead state was changed.",
      evidence: { previousStatus: current.callAheadStatus || null, requestedStatus: input.status },
    };
  }
  const saved = saveJobCallAheadStatus({
    date: input.date,
    jobKey: input.jobKey,
    status: input.status,
    expectedStatus: input.expectedStatus,
  });
  if (!saved) throw new Error("VERSION_CONFLICT: The call-ahead status changed before it could be saved.");
  return {
    mode,
    appointmentId: input.appointmentId,
    changed: true,
    verified: true,
    summary: `Call-ahead status recorded as ${input.status === "called" ? "called" : "not called"}.`,
    evidence: { status: saved.status, updatedAt: saved.updatedAt },
  };
}

export function verifyDispatchCallAhead(receipt: DispatchExecutionReceipt, input: DispatchCallAheadInput): ActionVerification {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const status = readJobCallAheadStatuses().get(`${input.date}|${input.jobKey}`);
  return status === input.status
    ? { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: { status } }
    : { outcome: "mismatch", summary: "The recorded call-ahead status does not match the requested outcome.", evidence: { status: status || null } };
}
