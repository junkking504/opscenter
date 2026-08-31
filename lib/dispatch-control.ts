import path from "node:path";
import type { ActionVerification } from "@/lib/platform/contracts";
import type { AnyRecord } from "@/lib/opsData";
import { cancelJunkwareAppointment } from "@/lib/junkware-appointment-cancellation";
import { rescheduleJunkwareAppointment } from "@/lib/junkware-appointment-reschedule";
import { classifyJunkwareAssignmentFailure } from "@/lib/junkware-assignment-failure";
import { readVerifiedJunkwareScheduleSnapshot } from "@/lib/junkware-fast-schedule";
import { readJobCallAheadStatuses, saveJobCallAheadStatus, type JobCallAheadStatus } from "@/lib/job-call-ahead";
import { readVerifiedJobCancellations, saveVerifiedJobCancellation } from "@/lib/job-cancellations";
import { readVerifiedJobReschedules, saveVerifiedJobReschedule } from "@/lib/job-reschedules";
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
  appointmentStartMinutes: number | null;
  appointmentEndMinutes: number | null;
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

export type DispatchRescheduleInput = {
  date: string;
  appointmentId: string;
  jobKey: string;
  appointmentStartMinutes: number;
  durationHours: number;
  expectedAppointmentTime: string;
  expectedEffectiveTruck: string;
  expectedRouteUpdatedAt: string;
  sourceObservedAt: string;
};

export type DispatchCancellationInput = {
  date: string;
  appointmentId: string;
  jobKey: string;
  cancellationReason: string;
  expectedStatus: string;
  expectedAppointmentTime: string;
  expectedRouteUpdatedAt: string;
  sourceObservedAt: string;
};

export type DispatchDateMoveInput = {
  date: string;
  appointmentId: string;
  jobKey: string;
  destinationDate: string;
  appointmentStartMinutes: number;
  expectedAppointmentStartMinutes: number;
  expectedAppointmentTime: string;
  expectedStatus: string;
  expectedRouteUpdatedAt: string;
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

function clockMinutes(value: string): number | null {
  const match = clean(value).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  const minute = Number(match[2]);
  if (minute > 59) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + minute;
}

function appointmentWindow(value: string): { start: number | null; end: number | null } {
  const [startValue = "", endValue = ""] = clean(value).split(/\s+-\s+/);
  return { start: clockMinutes(startValue), end: clockMinutes(endValue) };
}

function formatClock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  return `${String(hour % 12 || 12).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function formatAppointmentTime(startMinutes: number, endMinutes: number): string {
  return `${formatClock(startMinutes)} - ${formatClock(endMinutes)}`;
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
  const locallyCanceled = new Set(readVerifiedJobCancellations(date).map((entry) => entry.appointmentId));
  const movedFromDate = new Set(readVerifiedJobReschedules(date).map((entry) => entry.appointmentId));
  const appointments = snapshot.appointments
    .filter((row) => {
      const appointmentId = first(row, ["appt_id", "appointment_id", "appointmentId"]);
      return !closedOrCancelled(row) && !locallyCanceled.has(appointmentId) && !movedFromDate.has(appointmentId);
    })
    .map((row): DispatchControlAppointment | null => {
      const appointmentId = first(row, ["appt_id", "appointment_id", "appointmentId"]);
      if (!/^\d{1,12}$/.test(appointmentId)) return null;
      const jobKey = `appt:${appointmentId}`;
      const override = routeOverrides.get(jobKey);
      const sourceTruck = normalizeDispatchTruck(first(row, ["truck", "assigned_truck", "truck_number"]));
      const sourceAppointmentTime = first(row, ["appointment_time", "scheduled_time", "time_window"]) || "Time unavailable";
      const appointmentTime = override?.appointmentTime || sourceAppointmentTime;
      const sourceWindow = appointmentWindow(appointmentTime);
      return {
        appointmentId,
        jobKey,
        jkNumber: first(row, ["job_id", "jk_number", "job_number"]) || `Appointment ${appointmentId}`,
        customerName: first(row, ["customer_name", "customer", "name"]),
        appointmentTime,
        appointmentStartMinutes: override?.appointmentStartMinutes ?? sourceWindow.start,
        appointmentEndMinutes: override?.appointmentEndMinutes ?? sourceWindow.end,
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
    expectedUpdatedAt: input.expectedRouteUpdatedAt,
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

export async function executeDispatchReschedule(input: DispatchRescheduleInput): Promise<DispatchExecutionReceipt> {
  const current = currentAppointment(input);
  if (current.jobKey !== input.jobKey) throw new Error("Dispatch job identity mismatch.");
  if (
    current.appointmentTime !== input.expectedAppointmentTime
    || current.effectiveTruck !== input.expectedEffectiveTruck
    || current.routeUpdatedAt !== input.expectedRouteUpdatedAt
  ) {
    throw new Error("VERSION_CONFLICT: The appointment schedule changed after this request was prepared.");
  }
  const appointmentEndMinutes = input.appointmentStartMinutes + input.durationHours * 60;
  const appointmentTime = formatAppointmentTime(input.appointmentStartMinutes, appointmentEndMinutes);
  const mode = dispatchControlMode();
  if (mode === "preview_simulation") {
    return {
      mode,
      appointmentId: input.appointmentId,
      changed: current.appointmentTime !== appointmentTime,
      verified: true,
      summary: "Preview simulation verified; no OpsCenter schedule or JunkWare appointment time was changed.",
      evidence: { previousTime: current.appointmentTime, requestedTime: appointmentTime },
    };
  }

  const pending = saveJobRouteAssignment({
    date: input.date,
    jobKey: input.jobKey,
    truck: current.effectiveTruck,
    appointmentId: input.appointmentId,
    appointmentTime,
    appointmentStartMinutes: input.appointmentStartMinutes,
    appointmentEndMinutes,
    junkwareSyncStatus: "pending",
    expectedUpdatedAt: input.expectedRouteUpdatedAt,
  });
  if (!pending) throw new Error("VERSION_CONFLICT: The appointment schedule changed before it could be saved.");

  try {
    const junkware = await withJunkwareAppointmentSyncLock(input.appointmentId, () => syncJunkwareTruckAssignment({
      appointmentId: input.appointmentId,
      truck: current.effectiveTruck,
      appointmentStartMinutes: input.appointmentStartMinutes,
      durationHours: input.durationHours,
    }));
    const verified = saveJobRouteAssignment({
      date: input.date,
      jobKey: input.jobKey,
      truck: current.effectiveTruck,
      appointmentId: input.appointmentId,
      appointmentTime,
      appointmentStartMinutes: input.appointmentStartMinutes,
      appointmentEndMinutes,
      junkwareVerifiedAt: junkware.verifiedAt,
      junkwareSyncStatus: "verified",
      expectedUpdatedAt: pending.updatedAt,
    });
    if (!verified) throw new Error("VERSION_CONFLICT: The appointment schedule changed during JunkWare verification.");
    return {
      mode,
      appointmentId: input.appointmentId,
      changed: junkware.changed,
      verified: true,
      summary: `Appointment time verified in JunkWare as ${appointmentTime}.`,
      evidence: { appointmentTime, verifiedAt: junkware.verifiedAt, routeUpdatedAt: verified.updatedAt },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "JunkWare could not verify the appointment time.";
    const status = classifyJunkwareAssignmentFailure(error);
    saveJobRouteAssignment({
      date: input.date,
      jobKey: input.jobKey,
      truck: current.effectiveTruck,
      appointmentId: input.appointmentId,
      appointmentTime,
      appointmentStartMinutes: input.appointmentStartMinutes,
      appointmentEndMinutes,
      junkwareSyncStatus: status,
      junkwareSyncError: detail,
      expectedUpdatedAt: pending.updatedAt,
    });
    if (status === "manual_correction") throw new Error(`JunkWare rejected the appointment time: ${detail}`);
    return {
      mode,
      appointmentId: input.appointmentId,
      changed: true,
      verified: false,
      summary: "The new time is saved in OpsCenter and awaiting JunkWare verification.",
      evidence: { appointmentTime, pending: true },
    };
  }
}

export function verifyDispatchReschedule(receipt: DispatchExecutionReceipt, input: DispatchRescheduleInput): ActionVerification {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const record = readJobRouteAssignmentOverrides(input.date).get(input.jobKey);
  if (!record) return { outcome: "mismatch", summary: "The OpsCenter appointment time is missing." };
  if (record.appointmentStartMinutes !== input.appointmentStartMinutes) {
    return { outcome: "mismatch", summary: "The OpsCenter appointment time no longer matches the approved time." };
  }
  if (record.junkwareSyncStatus !== "verified" || !record.junkwareVerifiedAt) {
    return { outcome: "pending", summary: "The appointment time is still awaiting authoritative JunkWare verification." };
  }
  return {
    outcome: "verified",
    verifiedAt: record.junkwareVerifiedAt,
    summary: `Appointment time verified in JunkWare as ${record.appointmentTime}.`,
    evidence: { appointmentTime: record.appointmentTime, routeUpdatedAt: record.updatedAt },
  };
}

export async function executeDispatchCancellation(input: DispatchCancellationInput): Promise<DispatchExecutionReceipt> {
  const current = currentAppointment(input);
  if (current.jobKey !== input.jobKey) throw new Error("Dispatch job identity mismatch.");
  if (
    current.status !== input.expectedStatus
    || current.appointmentTime !== input.expectedAppointmentTime
    || current.routeUpdatedAt !== input.expectedRouteUpdatedAt
  ) {
    throw new Error("VERSION_CONFLICT: The appointment changed after this cancellation was prepared.");
  }
  const mode = dispatchControlMode();
  if (mode === "preview_simulation") {
    return {
      mode,
      appointmentId: input.appointmentId,
      changed: true,
      verified: true,
      summary: "Preview simulation verified; no appointment was canceled in OpsCenter or JunkWare.",
      evidence: { previousStatus: current.status, reasonRecorded: true },
    };
  }

  const junkware = await withJunkwareAppointmentSyncLock(
    input.appointmentId,
    () => cancelJunkwareAppointment(input.appointmentId, input.cancellationReason),
  );
  const cancellation = saveVerifiedJobCancellation({
    date: input.date,
    appointmentId: input.appointmentId,
    jobKey: input.jobKey,
    jkNumber: current.jkNumber,
    customerName: current.customerName,
    cancellationReason: input.cancellationReason,
    canceledAt: new Date().toISOString(),
    junkwareVerifiedAt: junkware.verifiedAt,
  });
  return {
    mode,
    appointmentId: input.appointmentId,
    changed: junkware.changed,
    verified: true,
    summary: "Appointment cancellation verified in JunkWare.",
    evidence: { status: junkware.status, verifiedAt: cancellation.junkwareVerifiedAt },
  };
}

export function verifyDispatchCancellation(receipt: DispatchExecutionReceipt, input: DispatchCancellationInput): ActionVerification {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const cancellation = readVerifiedJobCancellations(input.date)
    .find((entry) => entry.appointmentId === input.appointmentId);
  if (!cancellation) return { outcome: "mismatch", summary: "The verified cancellation receipt is missing." };
  if (cancellation.cancellationReason !== input.cancellationReason || !cancellation.junkwareVerifiedAt) {
    return { outcome: "mismatch", summary: "The cancellation receipt does not match the approved request." };
  }
  return {
    outcome: "verified",
    verifiedAt: cancellation.junkwareVerifiedAt,
    summary: "Appointment cancellation verified in JunkWare.",
    evidence: { canceledAt: cancellation.canceledAt },
  };
}

export async function executeDispatchDateMove(input: DispatchDateMoveInput): Promise<DispatchExecutionReceipt> {
  const current = currentAppointment(input);
  if (current.jobKey !== input.jobKey) throw new Error("Dispatch job identity mismatch.");
  if (
    current.appointmentStartMinutes !== input.expectedAppointmentStartMinutes
    || current.appointmentTime !== input.expectedAppointmentTime
    || current.status !== input.expectedStatus
    || current.routeUpdatedAt !== input.expectedRouteUpdatedAt
  ) {
    throw new Error("VERSION_CONFLICT: The appointment changed after this date move was prepared.");
  }
  const destinationTime = formatAppointmentTime(input.appointmentStartMinutes, input.appointmentStartMinutes + 60);
  const mode = dispatchControlMode();
  if (mode === "preview_simulation") {
    return {
      mode,
      appointmentId: input.appointmentId,
      changed: input.destinationDate !== input.date || input.appointmentStartMinutes !== current.appointmentStartMinutes,
      verified: true,
      summary: "Preview simulation verified; no appointment date or time was changed in JunkWare.",
      evidence: {
        previousDate: input.date,
        previousTime: current.appointmentTime,
        destinationDate: input.destinationDate,
        destinationTime,
      },
    };
  }

  const junkware = await withJunkwareAppointmentSyncLock(
    input.appointmentId,
    () => rescheduleJunkwareAppointment({
      appointmentId: input.appointmentId,
      date: input.destinationDate,
      appointmentStartMinutes: input.appointmentStartMinutes,
      expectedDate: input.date,
      expectedAppointmentStartMinutes: input.expectedAppointmentStartMinutes,
    }),
  );
  const reschedule = saveVerifiedJobReschedule({
    appointmentId: input.appointmentId,
    jobKey: input.jobKey,
    sourceDate: input.date,
    destinationDate: junkware.date,
    previousAppointmentStartMinutes: junkware.previousAppointmentStartMinutes,
    appointmentStartMinutes: junkware.appointmentStartMinutes,
    movedAt: new Date().toISOString(),
    junkwareVerifiedAt: junkware.verifiedAt,
  });
  return {
    mode,
    appointmentId: input.appointmentId,
    changed: junkware.changed,
    verified: true,
    summary: `Appointment move verified in JunkWare for ${input.destinationDate} at ${formatClock(input.appointmentStartMinutes)}.`,
    evidence: {
      previousDate: junkware.previousDate,
      previousAppointmentStartMinutes: junkware.previousAppointmentStartMinutes,
      destinationDate: junkware.date,
      appointmentStartMinutes: junkware.appointmentStartMinutes,
      verifiedAt: reschedule.junkwareVerifiedAt,
    },
  };
}

export function verifyDispatchDateMove(receipt: DispatchExecutionReceipt, input: DispatchDateMoveInput): ActionVerification {
  if (!receipt.verified) return { outcome: "pending", summary: "The JunkWare date move is still awaiting verification." };
  if (
    receipt.evidence.destinationDate !== input.destinationDate
    || Number(receipt.evidence.appointmentStartMinutes ?? input.appointmentStartMinutes) !== input.appointmentStartMinutes
  ) {
    return { outcome: "mismatch", summary: "The verified JunkWare date move does not match the approved destination." };
  }
  if (receipt.mode === "live_control") {
    const record = readVerifiedJobReschedules(input.date).find((entry) => entry.appointmentId === input.appointmentId);
    if (!record || record.destinationDate !== input.destinationDate || record.appointmentStartMinutes !== input.appointmentStartMinutes) {
      return { outcome: "mismatch", summary: "The verified appointment move receipt is missing or does not match the approved destination." };
    }
  }
  return {
    outcome: "verified",
    verifiedAt: String(receipt.evidence.verifiedAt || new Date().toISOString()),
    summary: receipt.summary,
    evidence: receipt.evidence,
  };
}
