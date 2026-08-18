import crypto from "crypto";
import fs from "fs";
import path from "path";
import { appointmentTerritoryForLocation } from "@/lib/appointment-territory";
import { appointmentNotes } from "@/lib/junkware-job-details";
import { AnyRecord, readMetrics } from "@/lib/opsData";

export type AddOnAppointment = {
  id: string;
  appointmentId: string;
  jobNumber: string;
  territory: string;
  customerName: string;
  phone: string;
  address: string;
  appointmentTime: string;
  appointmentType: string;
  assignedTruck: string;
  items: string[];
  href: string;
};

export type AddOnAppointmentFeed = {
  date: string;
  generatedAt: string | null;
  appointments: AddOnAppointment[];
};

export type CancelledAppointment = AddOnAppointment & {
  cancelledBy: string;
  cancellationReason: string;
};

export type CancelledAppointmentFeed = {
  date: string;
  generatedAt: string | null;
  appointments: CancelledAppointment[];
};

function firstText(row: AnyRecord, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = String(row?.[key] ?? "").replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return fallback;
}

function appointmentIdentity(row: AnyRecord): string {
  const durableId = firstText(row, ["appt_id", "appointment_id", "appointmentId"]);
  if (durableId) return `appt:${durableId}`;

  const jobNumber = firstText(row, ["job_id", "jk_number", "job_number"]);
  if (jobNumber) return `job:${jobNumber.toLowerCase()}`;

  const fingerprint = [
    firstText(row, ["customer_name", "customer"]),
    firstText(row, ["service_address", "address"]),
    firstText(row, ["appointment_time", "scheduled_time", "time_window"]),
    firstText(row, ["appointment_type", "type"]),
  ].join("|").toLowerCase();
  return `fallback:${crypto.createHash("sha256").update(fingerprint).digest("hex").slice(0, 20)}`;
}

function isCanceled(row: AnyRecord): boolean {
  const status = firstText(row, ["job_status", "status", "appointment_status"]).toLowerCase();
  return status.includes("cancel");
}

function jobAnchor(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function itemDescription(value: string): string {
  return String(value || "")
    .replace(/^Online request:\s*/i, "")
    .replace(/\s*,\s*(?:Business Name|Service Type|How did you hear about us)\s*:.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function appointmentItemDescriptions(row: AnyRecord): string[] {
  const descriptions = [
    firstText(row, ["job_description", "items", "item_description"]),
    ...appointmentNotes(row)
      .filter((note) => /^Online request:/i.test(note))
      .map(itemDescription),
  ]
    .map(itemDescription)
    .filter((description) => description && !/^new item$/i.test(description));
  return Array.from(new Set(descriptions));
}

function appointmentFromRow(row: AnyRecord, date: string): AddOnAppointment {
  const appointmentId = firstText(row, ["appt_id", "appointment_id", "appointmentId"]);
  const jobNumber = firstText(row, ["job_id", "jk_number", "job_number"], appointmentId || "Appointment");
  const anchorValue = jobNumber || appointmentId;

  return {
    id: appointmentIdentity(row),
    appointmentId,
    jobNumber,
    territory: appointmentTerritory(row),
    customerName: firstText(row, ["customer_name", "customer", "name"], "Customer name unavailable"),
    phone: firstText(
      row,
      ["customer_phone", "phone", "phone_number", "mobile_phone", "mobile"],
      "Phone unavailable",
    ),
    address: firstText(row, ["service_address", "address", "job_address"], "Address unavailable"),
    appointmentTime: firstText(row, ["appointment_time", "scheduled_time", "time_window"], "Time unavailable"),
    appointmentType: firstText(row, ["appointment_type", "type"], "Appointment"),
    assignedTruck: firstText(row, ["assigned_truck", "truck", "truck_number"], "Unassigned"),
    items: appointmentItemDescriptions(row),
    href: `/jobs?date=${encodeURIComponent(date)}${anchorValue ? `#job-${jobAnchor(anchorValue)}` : ""}`,
  };
}

function opsbotDataDirs(): string[] {
  const configured = String(process.env.OPSCENTER_DATA_DIR || "").trim();
  return Array.from(new Set([
    ...(configured ? [configured] : []),
    path.join(process.cwd(), "data"),
    path.join(process.cwd(), "..", "opsbot", "data"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  ]));
}

function readRawJunkwareDay(date: string): AnyRecord | null {
  for (const dataDir of opsbotDataDirs()) {
    const file = path.join(dataDir, "history", "junkware", `junkware_${date}_raw.json`);
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      if (payload && typeof payload === "object") return payload;
    } catch {
      // Try the next known OpsBot data location.
    }
  }
  return null;
}

export function appointmentTerritory(row: AnyRecord): string {
  return appointmentTerritoryForLocation(
    firstText(
      row,
      ["normalized_territory", "territory", "source_territory", "market"],
      "Unknown territory",
    ),
    firstText(row, ["service_address", "address", "job_address"]),
    firstText(row, ["service_city", "city", "City"]),
  );
}

export function buildAddOnAppointmentFeed(date: string): AddOnAppointmentFeed {
  const metrics = readMetrics(date);
  const sourceRows = Array.isArray(metrics?.appointments) ? metrics.appointments : [];
  const rawPayload = readRawJunkwareDay(date);
  const rawRows = [
    ...(Array.isArray(rawPayload?.appointments) ? rawPayload.appointments : []),
    ...(Array.isArray(rawPayload?.completed) ? rawPayload.completed : []),
  ];
  const seen = new Set<string>();
  const appointments: AddOnAppointment[] = [];

  for (const row of sourceRows) {
    if (!row || typeof row !== "object" || isCanceled(row)) continue;
    const rowAppointmentId = firstText(row, ["appt_id", "appointment_id", "appointmentId"]);
    const rowJobNumber = firstText(row, ["job_id", "jk_number", "job_number"]).toLowerCase();
    const rawRow = rawRows.find((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const candidateAppointmentId = firstText(candidate, ["appt_id", "appointment_id", "appointmentId"]);
      const candidateJobNumber = firstText(candidate, ["job_id", "jk_number", "job_number"]).toLowerCase();
      return Boolean(
        (rowAppointmentId && candidateAppointmentId === rowAppointmentId)
        || (rowJobNumber && candidateJobNumber === rowJobNumber),
      );
    });
    const appointment = appointmentFromRow(rawRow ? { ...rawRow, ...row } : row, date);
    if (seen.has(appointment.id)) continue;
    seen.add(appointment.id);
    appointments.push(appointment);
  }

  return {
    date,
    generatedAt: firstText(metrics || {}, ["generated_at", "updated_at"]) || null,
    appointments,
  };
}

export function buildCancelledAppointmentFeed(date: string): CancelledAppointmentFeed {
  const payload = readRawJunkwareDay(date);
  const sourceRows = Array.isArray(payload?.cancelled) ? payload.cancelled : [];
  const seen = new Set<string>();
  const appointments: CancelledAppointment[] = [];

  for (const row of sourceRows) {
    if (!row || typeof row !== "object") continue;
    const appointment = appointmentFromRow(row, date);
    if (seen.has(appointment.id)) continue;
    seen.add(appointment.id);
    appointments.push({
      ...appointment,
      cancelledBy: firstText(row, ["cancelled_by", "canceled_by"]),
      cancellationReason: firstText(row, ["cancellation_reason", "cancel_reason"]),
    });
  }

  return {
    date,
    generatedAt: firstText(payload || {}, ["scraped_at", "generated_at", "updated_at"]) || null,
    appointments,
  };
}
