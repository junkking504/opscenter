import fs from "node:fs";
import path from "node:path";
import { chicagoDateKey } from "@/lib/chicago-date";
import { sourceFileMemo } from "@/lib/source-file-memo";

type AnyRecord = Record<string, unknown>;

export type PodiumReviewInviteIdentity = {
  uid: string;
  customerName: string;
  channelIdentifier: string;
  locationUid: string;
};

export type PodiumReviewAppointmentAttribution = {
  status: "matched" | "ambiguous" | "unmatched";
  matchMethod?: "exact_phone" | "exact_email" | "manual_appointment";
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
  customerName: string;
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

// Every Campaign load reads every day's appointments to suggest review
// matches; reuse that reading until a daily metrics file changes.
const appointmentMemo = sourceFileMemo<AppointmentCandidate[]>(10 * 60_000, 4);
const DAILY_METRICS_FILE = /^daily_metrics_(\d{4}-\d{2}-\d{2})\.json$/;

function readAppointments(dataDir: string): AppointmentCandidate[] {
  const directory = path.join(dataDir, "processed");
  let names: string[];
  try {
    names = fs.readdirSync(directory).filter((file) => DAILY_METRICS_FILE.test(file));
  } catch {
    return [];
  }
  return appointmentMemo(directory, names.map((file) => path.join(directory, file)), () => parseAppointments(directory, names));
}

function parseAppointments(directory: string, names: string[]): AppointmentCandidate[] {
  const appointments = new Map<string, AppointmentCandidate>();
  try {
    for (const file of names) {
      const match = DAILY_METRICS_FILE.exec(file);
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
          customerName: clean(row.customer_name || row.customer),
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
  method: "exact_phone" | "exact_email" | "manual_appointment",
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

export type PodiumReviewAssignmentOption = {
  reference: string;
  appointmentId: string;
  jkNumber: string;
  appointmentDate: string;
  appointmentUrl: string;
  customerName: string;
  territory: string;
  truck: string;
  crew: string[];
  label: string;
};

export type PodiumReviewNameSuggestion = PodiumReviewAssignmentOption & {
  matchKind: "exact_name" | "exact_first_last" | "name_initial" | "partial_name" | "name_variation" | "crew_mention";
  evidence: string[];
};

export type PodiumReviewNameSuggestionInput = {
  uid: string;
  authorName: string;
  createdAt: string;
  locationName: string;
  body?: string;
};

function assignmentOption(candidate: AppointmentCandidate): PodiumReviewAssignmentOption {
  const reference = candidate.appointmentId || candidate.jkNumber;
  const details = [
    candidate.date,
    candidate.jkNumber,
    candidate.customerName,
    candidate.territory,
    candidate.crew.join(" + "),
  ].filter(Boolean);
  return {
    reference,
    appointmentId: candidate.appointmentId,
    jkNumber: candidate.jkNumber,
    appointmentDate: candidate.date,
    appointmentUrl: candidate.appointmentUrl,
    customerName: candidate.customerName,
    territory: candidate.territory,
    truck: candidate.truck,
    crew: candidate.crew,
    label: details.join(" · "),
  };
}

const ignoredNameParts = new Set(["mr", "mrs", "ms", "miss", "dr", "jr", "sr", "ii", "iii", "iv"]);

function nameParts(value: string): string[] {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((part) => part && !ignoredNameParts.has(part));
}

function preparedName(value: string) {
  const parts = nameParts(value);
  return { parts, sorted: [...parts].sort().join(" ") };
}

function nameMatchKind(
  reviewerName: ReturnType<typeof preparedName>,
  customerName: ReturnType<typeof preparedName>,
): Exclude<PodiumReviewNameSuggestion["matchKind"], "crew_mention"> | null {
  const reviewer = reviewerName.parts;
  const customer = customerName.parts;
  if (!reviewer.length || !customer.length) return null;
  if (reviewerName.sorted === customerName.sorted) return "exact_name";
  const reviewerFirst = reviewer[0];
  const reviewerLast = reviewer.at(-1) || "";
  const customerFirst = customer[0];
  const customerLast = customer.at(-1) || "";
  if (reviewerFirst === customerFirst && reviewerLast === customerLast) return "exact_first_last";
  if (reviewerFirst === customerFirst && reviewerLast.length === 1 && customerLast.startsWith(reviewerLast)) {
    return "name_initial";
  }
  if (customerFirst === reviewerFirst && customerLast.length === 1 && reviewerLast.startsWith(customerLast)) {
    return "name_initial";
  }
  if (reviewerFirst.length === 1 && customerFirst.startsWith(reviewerFirst) && reviewerLast === customerLast) {
    return "name_initial";
  }
  if ([reviewerFirst, reviewerLast].some(part => part.length >= 3 && [customerFirst, customerLast].includes(part))) return "partial_name";
  if ([reviewerFirst, reviewerLast].some(part => [customerFirst, customerLast].some(other => similarName(part, other)))) return "name_variation";
  return null;
}

const nicknameGroups = ["robert bob rob bobby", "william bill will billy", "james jim jimmy", "michael mike", "christopher chris", "joseph joe joey", "elizabeth liz beth", "katherine catherine kate katie", "eugene gene", "anthony tony", "richard rick dick", "alexander alex", "benjamin ben", "daniel dan danny", "thomas tom tommy"];
function similarName(left: string, right: string): boolean {
  if (left.length < 3 || right.length < 3) return false;
  if (left === right) return true;
  if (nicknameGroups.some(group => { const names = group.split(" "); return names.includes(left) && names.includes(right); })) return true;
  if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > 2) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(left[i - 1] !== right[j - 1]));
    previous = current;
  }
  return previous[right.length] <= (Math.min(left.length, right.length) >= 7 ? 2 : 1);
}

function normalizedTerritory(value: string): string {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bjunk king\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sameTerritory(locationName: string, territory: string): boolean {
  const location = normalizedTerritory(locationName);
  const candidate = normalizedTerritory(territory);
  return Boolean(location && candidate && (location === candidate || location.includes(candidate) || candidate.includes(location)));
}

export function buildPodiumReviewNameSuggestionMap(
  dataDir: string,
  reviews: PodiumReviewNameSuggestionInput[],
): Record<string, PodiumReviewNameSuggestion[]> {
  // Normalize each name once per call, rather than once per review pair.
  // Appointments are reread whenever a daily metrics file changes.
  const appointments = readAppointments(dataDir)
    .filter((candidate) => candidate.crew.length > 0 && candidate.customerName)
    .map((candidate) => ({ candidate, name: preparedName(candidate.customerName) }));
  return Object.fromEntries(reviews.map((review) => {
    const reviewDate = dateKey(review.createdAt);
    const earliestDate = reviewDate ? dateDaysBefore(reviewDate, 90) : "";
    const reviewerName = preparedName(review.authorName);
    const words = nameParts(review.body || "");
    const crewMentions = new Map<string, boolean>();
    const nameMatches = new Map<string, ReturnType<typeof nameMatchKind>>();
    const suggestions = reviewDate ? appointments
      .filter(({ candidate }) => candidate.date >= earliestDate && candidate.date <= reviewDate)
      .map(({ candidate, name }) => {
        if (!nameMatches.has(name.sorted)) nameMatches.set(name.sorted, nameMatchKind(reviewerName, name));
        const nameKind = nameMatches.get(name.sorted) ?? null;
        const crew = candidate.crew.filter(member => {
          if (!crewMentions.has(member)) {
            const first = nameParts(member)[0];
            crewMentions.set(member, Boolean(first && first.length >= 3 && words.some(word => similarName(first, word))));
          }
          return crewMentions.get(member);
        });
        const local = sameTerritory(review.locationName, candidate.territory);
        const matchKind = nameKind || (crew.length && local ? "crew_mention" as const : null);
        const evidence = [nameKind ? ({exact_name:"Exact customer name",exact_first_last:"First and last name",name_initial:"Name and initial",partial_name:"First or last name",name_variation:"Possible spelling or nickname variation"} as const)[nameKind] : "", crew.length ? `Review mentions recorded crew: ${crew.join(" + ")}` : "", local ? "Same location" : ""].filter(Boolean);
        const rank = nameKind ? ({exact_name:100,exact_first_last:95,name_initial:75,partial_name:40,name_variation:30} as const)[nameKind] : 0;
        return {candidate, matchKind, evidence, score: rank + crew.length * 25 + Number(local) * 10};
      })
      .filter(entry => entry.matchKind !== null)
      .sort((left, right) => right.score - left.score
        || right.candidate.date.localeCompare(left.candidate.date)
        || left.candidate.jkNumber.localeCompare(right.candidate.jkNumber))
      .slice(0, 5)
      .map(({ candidate, matchKind, evidence }) => ({ ...assignmentOption(candidate), matchKind: matchKind!, evidence })) : [];
    return [review.uid, suggestions];
  }));
}

export function listPodiumReviewAssignmentOptions(
  dataDir: string,
  earliestDate = "",
): PodiumReviewAssignmentOption[] {
  return readAppointments(dataDir)
    .filter((candidate) => candidate.crew.length > 0 && (!earliestDate || candidate.date >= earliestDate))
    .sort((left, right) => right.date.localeCompare(left.date)
      || left.jkNumber.localeCompare(right.jkNumber))
    .map(assignmentOption);
}

export function findPodiumReviewAppointment(
  dataDir: string,
  referenceValue: string,
): PodiumReviewAppointmentAttribution | null {
  const reference = clean(referenceValue).toLowerCase();
  if (!reference) return null;
  const candidates = readAppointments(dataDir)
    .filter((candidate) => candidate.crew.length > 0)
    .filter((candidate) => candidate.appointmentId.toLowerCase() === reference
      || candidate.jkNumber.toLowerCase() === reference)
    .sort((left, right) => right.date.localeCompare(left.date));
  return candidates.length ? sanitizedMatch(candidates[0], "manual_appointment") : null;
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
