import type { ActionVerification } from "@/lib/platform/contracts";
import {
  customerContactRecord,
  readCustomerContactStore,
  saveApprovedCustomerContact,
  saveCustomerContactOutcome,
  type CustomerContactChannel,
  type CustomerContactOutcome,
  type CustomerContactRecord,
  type CustomerContactStore,
} from "@/lib/customer-contact-store";
import { readDispatchControlSnapshot, type DispatchControlSnapshot } from "@/lib/dispatch-control";
import { addJunkwareAppointmentNote } from "@/lib/junkware-appointment-note";
import { withJunkwareAppointmentSyncLock } from "@/lib/job-route-assignments";
import { getOpsRuntime } from "@/lib/runtime";

export type CustomerContactMode = "live_control" | "preview_simulation";

export type CustomerContactAppointment = {
  appointmentId: string;
  jobKey: string;
  jkNumber: string;
  customerName: string;
  phone: string;
  maskedPhone: string;
  appointmentTime: string;
  status: string;
  territory: string;
  sourceObservedAt: string;
  observationKey: string;
  latestPlan: CustomerContactRecord | null;
  planCurrent: boolean;
};

export type CustomerContactSnapshot = {
  date: string;
  mode: CustomerContactMode;
  source: "JunkWare verified schedule + OpsCenter governed contact records";
  sourceObservedAt: string;
  storeUpdatedAt: string;
  appointments: CustomerContactAppointment[];
  summary: { contactable: number; approved: number; outcomesRecorded: number; notCompleted: number };
  authorityNotice: string;
  warning?: string;
};

export type CustomerContactPlanInput = {
  date: string;
  appointmentId: string;
  jobKey: string;
  channel: CustomerContactChannel;
  purpose: string;
  message: string;
  owner: string;
  nextAction: string;
  sourceObservedAt: string;
  expectedObservationKey: string;
  expectedStoreUpdatedAt: string;
};

export type CustomerContactOutcomeInput = {
  date: string;
  appointmentId: string;
  jobKey: string;
  recordId: string;
  outcome: CustomerContactOutcome;
  evidenceNote: string;
  sourceObservedAt: string;
  expectedObservationKey: string;
  expectedStoreUpdatedAt: string;
  expectedRecordUpdatedAt: string;
};

export type CustomerContactReceipt = {
  mode: CustomerContactMode;
  recordId: string;
  appointmentId: string;
  changed: boolean;
  verified: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

export type CustomerContactSnapshotReader = (date: string) => CustomerContactSnapshot;

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizedPhone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function maskedPhone(value: unknown): string {
  const digits = normalizedPhone(value);
  return digits ? `(***) ***-${digits.slice(-4)}` : "Unavailable";
}

export function customerContactMode(): CustomerContactMode {
  return getOpsRuntime() === "MISSION_CONTROL" ? "live_control" : "preview_simulation";
}

export function buildCustomerContactSnapshot(
  date: string,
  dispatch: DispatchControlSnapshot,
  store: CustomerContactStore = readCustomerContactStore(),
): CustomerContactSnapshot {
  const appointments = dispatch.appointments.flatMap((appointment): CustomerContactAppointment[] => {
    if (!normalizedPhone(appointment.phone)) return [];
    const records = store.records.filter((record) => record.date === date && record.appointmentId === appointment.appointmentId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const latestPlan = records[0] || null;
    return [{
      appointmentId: appointment.appointmentId,
      jobKey: appointment.jobKey,
      jkNumber: appointment.jkNumber,
      customerName: appointment.customerName,
      phone: appointment.phone,
      maskedPhone: maskedPhone(appointment.phone),
      appointmentTime: appointment.appointmentTime,
      status: appointment.status,
      territory: appointment.territory,
      sourceObservedAt: appointment.sourceObservedAt,
      observationKey: appointment.contactObservationKey,
      latestPlan,
      planCurrent: Boolean(latestPlan && latestPlan.sourceObservationKey === appointment.contactObservationKey),
    }];
  });
  const currentRecords = appointments.flatMap((appointment) => appointment.planCurrent && appointment.latestPlan
    ? [appointment.latestPlan]
    : []);
  return {
    date,
    mode: customerContactMode(),
    source: "JunkWare verified schedule + OpsCenter governed contact records",
    sourceObservedAt: dispatch.sourceObservedAt,
    storeUpdatedAt: store.updatedAt,
    appointments,
    summary: {
      contactable: appointments.length,
      approved: currentRecords.filter((record) => record.status === "approved").length,
      outcomesRecorded: currentRecords.filter((record) => record.status === "outcome_recorded").length,
      notCompleted: currentRecords.filter((record) => record.status === "not_completed").length,
    },
    authorityNotice: "JunkWare supplies the appointment and phone. OpsBot stores no phone in the action or contact ledger. Approval unlocks only a human call or text draft; OpsBot does not send it. A recorded outcome is written back as a verified JunkWare appointment note, while carrier delivery remains unverified.",
    warning: dispatch.warning,
  };
}

export function readCustomerContactSnapshot(date: string): CustomerContactSnapshot {
  return buildCustomerContactSnapshot(date, readDispatchControlSnapshot(date), readCustomerContactStore());
}

function currentAppointment(
  input: Pick<CustomerContactPlanInput, "date" | "appointmentId" | "jobKey" | "sourceObservedAt" | "expectedObservationKey">,
  snapshotReader: CustomerContactSnapshotReader,
): CustomerContactAppointment {
  const snapshot = snapshotReader(input.date);
  const appointment = snapshot.appointments.find((candidate) => candidate.appointmentId === input.appointmentId);
  if (!appointment) throw new Error("The customer appointment is not present in the current verified JunkWare schedule with a contact number.");
  if (appointment.jobKey !== input.jobKey) throw new Error("Customer contact appointment identity mismatch.");
  if (appointment.observationKey !== input.expectedObservationKey) {
    throw new Error("VERSION_CONFLICT: JunkWare appointment or contact evidence changed after this request was prepared.");
  }
  return appointment;
}

export async function executeCustomerContactPlan(
  input: CustomerContactPlanInput,
  actorLabel: string,
  actionRunId: string,
  snapshotReader: CustomerContactSnapshotReader = readCustomerContactSnapshot,
): Promise<CustomerContactReceipt> {
  const appointment = currentAppointment(input, snapshotReader);
  const snapshot = snapshotReader(input.date);
  if (snapshot.storeUpdatedAt !== input.expectedStoreUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Customer contact state changed after this request was prepared.");
  }
  const mode = customerContactMode();
  const evidence = {
    appointmentId: appointment.appointmentId,
    jkNumber: appointment.jkNumber,
    channel: input.channel,
    sourceObservedAt: input.sourceObservedAt,
    sourceObservationKey: input.expectedObservationKey,
    phoneStored: false,
    outboundSent: false,
  };
  if (mode === "preview_simulation") {
    return {
      mode,
      recordId: actionRunId,
      appointmentId: appointment.appointmentId,
      changed: false,
      verified: true,
      summary: "Preview simulation verified; no customer contact plan, message, or JunkWare note was created.",
      evidence,
    };
  }
  const record = saveApprovedCustomerContact({
    recordId: actionRunId,
    date: input.date,
    appointmentId: input.appointmentId,
    jobKey: input.jobKey,
    channel: input.channel,
    purpose: input.purpose,
    message: input.channel === "sms" ? input.message : "",
    owner: input.owner,
    nextAction: input.nextAction,
    sourceObservationKey: input.expectedObservationKey,
    sourceObservedAt: input.sourceObservedAt,
    requestedBy: actorLabel,
  }, input.expectedStoreUpdatedAt);
  return {
    mode,
    recordId: record.recordId,
    appointmentId: record.appointmentId,
    changed: true,
    verified: true,
    summary: "Customer contact plan approved and verified in OpsCenter; no outbound contact was sent.",
    evidence: { ...evidence, updatedAt: record.updatedAt },
  };
}

export function verifyCustomerContactPlan(
  receipt: CustomerContactReceipt,
  input: CustomerContactPlanInput,
): ActionVerification {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const record = customerContactRecord(receipt.recordId);
  if (!record || record.status !== "approved" || record.appointmentId !== input.appointmentId || record.channel !== input.channel || record.message !== (input.channel === "sms" ? input.message : "")) {
    return { outcome: "mismatch", summary: "The approved customer contact plan does not match the requested appointment, channel, and draft." };
  }
  return { outcome: "verified", verifiedAt: record.updatedAt, summary: receipt.summary, evidence: { ...receipt.evidence, updatedAt: record.updatedAt } };
}

function contactOutcomeNote(record: CustomerContactRecord, input: CustomerContactOutcomeInput): string {
  const channel = record.channel === "sms" ? "SMS" : "phone";
  return clean(`[OpsBot Contact] ${channel} outcome: ${input.outcome.replaceAll("_", " ")}. Owner: ${record.owner}. Evidence: ${input.evidenceNote}`).slice(0, 500);
}

export async function executeCustomerContactOutcome(
  input: CustomerContactOutcomeInput,
  actorLabel: string,
  snapshotReader: CustomerContactSnapshotReader = readCustomerContactSnapshot,
  noteWriter: typeof addJunkwareAppointmentNote = addJunkwareAppointmentNote,
): Promise<CustomerContactReceipt> {
  const appointment = currentAppointment(input, snapshotReader);
  const snapshot = snapshotReader(input.date);
  const record = customerContactRecord(input.recordId);
  if (!record || record.appointmentId !== input.appointmentId || record.jobKey !== input.jobKey) {
    throw new Error("The approved customer contact plan is unavailable for this appointment.");
  }
  if (snapshot.storeUpdatedAt !== input.expectedStoreUpdatedAt || record.updatedAt !== input.expectedRecordUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Customer contact state changed after this outcome was prepared.");
  }
  if (
    record.status !== "approved"
    || record.sourceObservationKey !== input.expectedObservationKey
    || !appointment.planCurrent
    || appointment.latestPlan?.recordId !== record.recordId
  ) {
    throw new Error("VERSION_CONFLICT: The approved contact plan is based on prior JunkWare evidence.");
  }
  if (record.channel === "sms" && !["sms_sent", "sms_not_sent"].includes(input.outcome)) throw new Error("Choose a valid SMS outcome.");
  if (record.channel === "phone" && !["reached", "voicemail", "no_answer"].includes(input.outcome)) throw new Error("Choose a valid phone outcome.");
  const mode = customerContactMode();
  const evidence = {
    appointmentId: appointment.appointmentId,
    recordId: record.recordId,
    channel: record.channel,
    outcome: input.outcome,
    carrierDeliveryVerified: false,
  };
  if (mode === "preview_simulation") {
    return {
      mode,
      recordId: record.recordId,
      appointmentId: record.appointmentId,
      changed: false,
      verified: true,
      summary: "Preview simulation verified; no customer-contact outcome or JunkWare note was written.",
      evidence,
    };
  }
  const junkware = await withJunkwareAppointmentSyncLock(input.appointmentId, () => noteWriter({
    appointmentId: input.appointmentId,
    note: contactOutcomeNote(record, input),
  }));
  const saved = saveCustomerContactOutcome({
    recordId: record.recordId,
    outcome: input.outcome,
    evidenceNote: input.evidenceNote,
    junkwareVerifiedAt: junkware.verifiedAt,
    updatedBy: actorLabel,
  }, {
    storeUpdatedAt: input.expectedStoreUpdatedAt,
    recordUpdatedAt: input.expectedRecordUpdatedAt,
  });
  return {
    mode,
    recordId: saved.recordId,
    appointmentId: saved.appointmentId,
    changed: true,
    verified: true,
    summary: "Human-confirmed customer-contact outcome verified in the JunkWare appointment notes; carrier delivery is not verified.",
    evidence: { ...evidence, junkwareVerifiedAt: junkware.verifiedAt, updatedAt: saved.updatedAt },
  };
}

export function verifyCustomerContactOutcome(
  receipt: CustomerContactReceipt,
  input: CustomerContactOutcomeInput,
): ActionVerification {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const record = customerContactRecord(input.recordId);
  if (!record || record.outcome !== input.outcome || record.evidenceNote !== input.evidenceNote || !record.junkwareVerifiedAt) {
    return { outcome: "mismatch", summary: "The customer-contact ledger and verified JunkWare note do not match the recorded outcome." };
  }
  return { outcome: "verified", verifiedAt: record.junkwareVerifiedAt, summary: receipt.summary, evidence: { ...receipt.evidence, junkwareVerifiedAt: record.junkwareVerifiedAt } };
}
