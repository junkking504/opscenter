import crypto from "crypto";
import { AnyRecord, readMetrics } from "@/lib/opsData";

export type AddOnAppointment = {
  id: string;
  appointmentId: string;
  jobNumber: string;
  customerName: string;
  address: string;
  appointmentTime: string;
  appointmentType: string;
  assignedTruck: string;
  href: string;
};

export type AddOnAppointmentFeed = {
  date: string;
  generatedAt: string | null;
  appointments: AddOnAppointment[];
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

export function buildAddOnAppointmentFeed(date: string): AddOnAppointmentFeed {
  const metrics = readMetrics(date);
  const sourceRows = Array.isArray(metrics?.appointments) ? metrics.appointments : [];
  const seen = new Set<string>();
  const appointments: AddOnAppointment[] = [];

  for (const row of sourceRows) {
    if (!row || typeof row !== "object" || isCanceled(row)) continue;
    const id = appointmentIdentity(row);
    if (seen.has(id)) continue;
    seen.add(id);

    const appointmentId = firstText(row, ["appt_id", "appointment_id", "appointmentId"]);
    const jobNumber = firstText(row, ["job_id", "jk_number", "job_number"], appointmentId || "Appointment");
    const anchorValue = jobNumber || appointmentId;

    appointments.push({
      id,
      appointmentId,
      jobNumber,
      customerName: firstText(row, ["customer_name", "customer", "name"], "Customer name unavailable"),
      address: firstText(row, ["service_address", "address", "job_address"], "Address unavailable"),
      appointmentTime: firstText(row, ["appointment_time", "scheduled_time", "time_window"], "Time unavailable"),
      appointmentType: firstText(row, ["appointment_type", "type"], "Appointment"),
      assignedTruck: firstText(row, ["assigned_truck", "truck", "truck_number"], "Unassigned"),
      href: `/jobs?date=${encodeURIComponent(date)}${anchorValue ? `#job-${jobAnchor(anchorValue)}` : ""}`,
    });
  }

  return {
    date,
    generatedAt: firstText(metrics || {}, ["generated_at", "updated_at"]) || null,
    appointments,
  };
}
