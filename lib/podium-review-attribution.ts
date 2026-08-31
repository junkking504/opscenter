import fs from "node:fs";
import path from "node:path";
import { chicagoDateKey } from "@/lib/chicago-date";

type AnyRecord = Record<string, unknown>;

export type PodiumReviewInviteIdentity = {
  uid: string;
  customerName: string;
  channelIdentifier: string;
  locationUid: string;
};

export type PodiumReviewAppointmentAttribution = {
  status: "matched" | "ambiguous" | "unmatched";
  matchMethod?: "exact_phone" | "exact_email";
  appointmentId?: string;
  jkNumber?: string;
  appointmentDate?: string;
  appointmentUrl?: string;
  territory?: string;
  truck?: string;
  crew?: string[];
};

type AppointmentCandidate = {
  date: string;
  appointmentId: string;
  jkNumber: string;
  appointmentUrl: string;
  territory: string;
  truck: string;
  crew: string[];
  identifiers: Set<string>;
};

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function recordRows(value: unknown): AnyRecord[] {
  return Array.isArray(value)
    ? value.filter((row): row is AnyRecord => Boolean(row && typeof row === "object"))
    : [];
}

function normalizeEmail(value: unknown): string {
  const email = clean(value).toLowerCase();
  return email.includes("@") ? email : "";
}

function normalizePhone(value: unknown): string {
  const digits = clean(value).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  const text = clean(value);
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(clean).filter(Boolean);
    } catch {
      // Treat an unparseable value as one display name.
    }
  }
  return text.split(/\s*(?:,|&|\band\b)\s*/i).map(clean).filter(Boolean);
}

function crewNames(row: AnyRecord): string[] {
  return unique([
    clean(row.driver_normalized_name || row.driver_name || row.driver),
    clean(row.navigator_normalized_name || row.navigator_name || row.navigator),
    ...stringList(row.additional_crew),
    ...stringList(row.credited_crew),
  ]);
}

function completedServiceAppointment(row: AnyRecord): boolean {
  const status = clean(row.job_status || row.final_status || row.complete_status_text).toLowerCase();
  const type = clean(row.appointment_type || row.final_appointment_type).toLowerCase();
  return /complete|closed|paid/.test(status) && !/estimate/.test(type);
}

function appointmentIdentifiers(row: AnyRecord): Set<string> {
  return new Set([
    normalizePhone(row.customer_phone),
    normalizePhone(row.phone),
    normalizeEmail(row.customerEmail),
    normalizeEmail(row.customer_email),
  ].filter(Boolean));
}

function readAppointments(dataDir: string): AppointmentCandidate[] {
  const directory = path.join(dataDir, "processed");
  const appointments = new Map<string, AppointmentCandidate>();
  try {
    for (const file of fs.readdirSync(directory)) {
      const match = /^daily_metrics_(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
      if (!match) continue;
      const payload = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")) as AnyRecord;
      for (const row of recordRows(payload.appointments)) {
        if (!completedServiceAppointment(row)) continue;
        const appointmentId = clean(row.appt_id || row.appointment_id);
        const jkNumber = clean(row.job_id || row.jk_number);
        const key = `${match[1]}|${appointmentId || jkNumber}`;
        const appointmentUrl = clean(row.source_page) || (appointmentId
          ? `https://junkware.junk-king.com/franchise/appointment.aspx?id=${encodeURIComponent(appointmentId)}`
          : "");
        appointments.set(key, {
          date: match[1],
          appointmentId,
          jkNumber,
          appointmentUrl,
          territory: clean(row.normalized_territory || row.territory || row.market),
          truck: clean(row.assigned_truck || row.truck || row.truck_number),
          crew: crewNames(row),
          identifiers: appointmentIdentifiers(row),
        });
      }
    }
  } catch {
    return [];
  }
  return Array.from(appointments.values());
}

function dateKey(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? chicagoDateKey(date) : "";
}

function dateDaysBefore(value: string, days: number): string {
  const timestamp = new Date(`${value}T12:00:00Z`).getTime();
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp - days * 86_400_000).toISOString().slice(0, 10);
}

function sanitizedMatch(
  candidate: AppointmentCandidate,
  method: "exact_phone" | "exact_email",
): PodiumReviewAppointmentAttribution {
  return {
    status: "matched",
    matchMethod: method,
    appointmentId: candidate.appointmentId,
    jkNumber: candidate.jkNumber,
    appointmentDate: candidate.date,
    appointmentUrl: candidate.appointmentUrl,
    territory: candidate.territory,
    truck: candidate.truck,
    crew: candidate.crew,
  };
}

export function buildPodiumAppointmentMatcher(dataDir: string) {
  const appointments = readAppointments(dataDir);
  return (reviewCreatedAt: string, invite: PodiumReviewInviteIdentity | null): PodiumReviewAppointmentAttribution => {
    const reviewDate = dateKey(reviewCreatedAt);
    const identifier = normalizePhone(invite?.channelIdentifier) || normalizeEmail(invite?.channelIdentifier);
    if (!reviewDate || !identifier) return { status: "unmatched" };
    const method = normalizePhone(invite?.channelIdentifier) ? "exact_phone" : "exact_email";
    const earliestDate = dateDaysBefore(reviewDate, 90);
    const candidates = appointments.filter((appointment) =>
      appointment.date >= earliestDate
      && appointment.date <= reviewDate
      && appointment.identifiers.has(identifier));
    if (!candidates.length) return { status: "unmatched" };
    const latestDate = candidates.map((candidate) => candidate.date).sort().at(-1) || "";
    const latest = candidates.filter((candidate) => candidate.date === latestDate);
    return latest.length === 1 ? sanitizedMatch(latest[0], method) : { status: "ambiguous" };
  };
}
