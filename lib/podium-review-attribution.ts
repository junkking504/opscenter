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
  matchMethod?: "exact_phone" | "exact_email" | "manual_appointment" | "inferred_high" | "manual_unassigned";
  score?: number;
  reasons?: string[];
  rulesVersion?: string;
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
  completedAt: number | null;
  emailHandle: string;
  contextTokens: Set<string>;
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
  return /^(completed?|closed|paid)(?:\b|$)/.test(status) && !/estimate/.test(type);
}

function appointmentIdentifiers(row: AnyRecord): Set<string> {
  return new Set([
    normalizePhone(row.customer_phone),
    normalizePhone(row.phone),
    normalizeEmail(row.customerEmail),
    normalizeEmail(row.customer_email),
    normalizeEmail(row.email),
  ].filter(Boolean));
}

// Every Campaign load reads every day's appointments to suggest review
// matches; reuse that reading until a daily metrics file changes.
const appointmentMemo = sourceFileMemo<AppointmentCandidate[]>(10 * 60_000, 4);
const DAILY_METRICS_FILE = /^daily_metrics_(\d{4}-\d{2}-\d{2})\.json$/;

function appointmentSources(dataDir: string): { directory: string; names: string[]; files: string[] } | null {
  const directory = path.join(dataDir, "processed");
  let names: string[];
  try {
    names = fs.readdirSync(directory).filter((file) => DAILY_METRICS_FILE.test(file));
  } catch {
    return null;
  }
  const rawFiles = names.map(file => path.join(dataDir, "history", "junkware", `junkware_${DAILY_METRICS_FILE.exec(file)![1]}_raw.json`));
  return { directory, names, files: [...names.map(file => path.join(directory, file)), ...rawFiles] };
}

/** Every file the appointment reading depends on; a memo keyed on these sees any collector write. */
export function appointmentSourceFiles(dataDir: string): string[] {
  return appointmentSources(dataDir)?.files ?? [];
}

function readAppointments(dataDir: string): AppointmentCandidate[] {
  const sources = appointmentSources(dataDir);
  if (!sources) return [];
  return appointmentMemo(sources.directory, sources.files, () => parseAppointments(sources.directory, sources.names));
}

// Only explicit completion evidence is used; scheduled/GPS departure times are
// not completion. Parse JunkWare's Chicago wall clock without host-TZ dependence.
const completionClock = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
function completionTime(value: unknown): number | null {
  const text = clean(value);
  if (!text) return null;
  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const stamp = Date.parse(text);
    return Number.isFinite(stamp) ? stamp : null;
  }
  const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))? (AM|PM)$/i.exec(text);
  if (!parts) return null;
  const [, month, day, year, hour, minute, second, period] = parts;
  if (+hour < 1 || +hour > 12 || +minute > 59 || +(second || 0) > 59 || +month < 1 || +month > 12 || +day < 1 || +day > 31) return null;
  const wall = Date.UTC(+year, +month - 1, +day, (+hour % 12) + (period.toUpperCase() === "PM" ? 12 : 0), +minute, +(second || 0));
  const calendar = new Date(wall);
  if (calendar.getUTCFullYear() !== +year || calendar.getUTCMonth() !== +month - 1 || calendar.getUTCDate() !== +day) return null;
  // Try both Chicago offsets, validating the round trip (including DST).
  for (const offset of [5, 6]) {
    const stamp = wall + offset * 3_600_000;
    const fields = Object.fromEntries(completionClock.formatToParts(new Date(stamp)).map(part => [part.type, part.value]));
    if (Date.UTC(+fields.year, +fields.month - 1, +fields.day, +fields.hour, +fields.minute, +fields.second) === wall) return stamp;
  }
  return null;
}

function parseAppointments(directory: string, names: string[]): AppointmentCandidate[] {
  const appointments = new Map<string, AppointmentCandidate>();
  for (const file of names.sort()) {
    const match = DAILY_METRICS_FILE.exec(file);
    if (!match) continue;
    let payload: AnyRecord;
    try { payload = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")); } catch { return []; }
    if (!Array.isArray(payload.appointments)) return [];
    let raw: AnyRecord = {};
    try { raw = JSON.parse(fs.readFileSync(path.join(directory, "..", "history", "junkware", `junkware_${match[1]}_raw.json`), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return []; }
    const details = new Map<string, AnyRecord>();
    for (const row of [...recordRows(raw.appointments), ...recordRows(raw.completed)]) {
      const id = clean(row.appt_id || row.appointment_id);
      if (id) details.set(id, { ...details.get(id), ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== "" && value != null)) });
    }
    for (const metric of recordRows(payload.appointments)) {
      if (!completedServiceAppointment(metric)) continue;
      const appointmentId = clean(metric.appt_id || metric.appointment_id);
      const jkNumber = clean(metric.job_id || metric.jk_number);
      if (!appointmentId && !jkNumber) continue;
      const detail = details.get(appointmentId);
      // Never enrich a recycled/mismatched appointment identity.
      const row = { ...metric, ...(detail && (!detail.job_id || clean(detail.job_id) === jkNumber) ? detail : {}) };
      if (!completedServiceAppointment(row)) continue;
      const completedAt = completionTime(row.completed_at);
      if (clean(row.completed_at) && completedAt === null) continue;
      const completionDate = clean(row.completion_date || row.completed_date);
      const date = completedAt !== null ? chicagoDateKey(new Date(completedAt)) : (/^\d{4}-\d{2}-\d{2}$/.test(completionDate) ? completionDate : match[1]);
      appointments.set(appointmentId || jkNumber, {
        date, completedAt, appointmentId, jkNumber,
        customerName: clean(row.customer_name || row.customer),
        appointmentUrl: clean(row.source_page) || (appointmentId ? `https://junkware.junk-king.com/franchise/appointment.aspx?id=${encodeURIComponent(appointmentId)}` : ""),
        territory: clean(metric.normalized_territory || metric.territory || metric.market),
        truck: clean(metric.assigned_truck || metric.truck || metric.truck_number),
        crew: crewNames(metric),
        identifiers: appointmentIdentifiers(row),
        emailHandle: normalizeEmail(row.customerEmail || row.customer_email || row.email).split("@")[0].replace(/[^a-z0-9]/g, ""),
        contextTokens: contextTokens([row.appointment_notes, row.customer_notes, row.additional_notes, row.franchise_notes, row.job_description, row.job_notes, row.notes, row.business_name, row.property_name, row.service_street, row.neighbourhood, row.neighborhood, row.service_address, row.address, row.parish].map(clean).join(" ")),
      });
    }
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
  method: NonNullable<PodiumReviewAppointmentAttribution["matchMethod"]>,
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
  matchKind: "exact_name" | "exact_first_last" | "name_initial" | "partial_name" | "name_variation" | "crew_mention" | "email_handle" | "context" | "timing";
  score: number;
  confidence: "High" | "Medium" | "Low";
  rulesVersion: string;
  evidence: string[];
};

export type PodiumReviewNameSuggestionInput = {
  uid: string;
  authorName: string;
  createdAt: string;
  locationName: string;
  body?: string;
  invite?: PodiumReviewInviteIdentity | null;
  // Sanitized signal 2 is retained by the collector, never invite contact data.
  inviteNameReferences?: string[];
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
): "exact_name" | "exact_first_last" | "name_initial" | "partial_name" | "name_variation" | null {
  const reviewer = reviewerName.parts;
  const customer = customerName.parts;
  if (!reviewer.length || !customer.length) return null;
  if (reviewer.length === 1 || customer.length === 1) {
    return reviewer.some(part => part.length >= 3 && customer.includes(part)) ? "partial_name" : null;
  }
  if (reviewerName.sorted === customerName.sorted) {
    if (reviewer.every(part => part.length === 1)) return null;
    return reviewer.some(part => part.length === 1) ? "name_initial" : "exact_name";
  }
  const reviewerFirst = reviewer[0];
  const reviewerLast = reviewer.at(-1) || "";
  const customerFirst = customer[0];
  const customerLast = customer.at(-1) || "";
  if (reviewerFirst.length > 1 && reviewerLast.length > 1 && reviewerFirst === customerFirst && reviewerLast === customerLast) return "exact_first_last";
  if (reviewerFirst === customerFirst && reviewerLast.length === 1 && customerLast.startsWith(reviewerLast)) {
    return "name_initial";
  }
  if (customerFirst === reviewerFirst && customerLast.length === 1 && reviewerLast.startsWith(customerLast)) {
    return "name_initial";
  }
  if (reviewerFirst.length === 1 && customerFirst.startsWith(reviewerFirst) && reviewerLast === customerLast) {
    return "name_initial";
  }
  if (reviewer.length >= 2 && customer.length >= 2 && similarName(reviewerFirst, customerFirst) && similarName(reviewerLast, customerLast)) return "name_variation";
  if ([reviewerFirst, reviewerLast].some(part => part.length >= 3 && [customerFirst, customerLast].includes(part))) return "partial_name";
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

// Body prose needs stricter matching than public reviewer/customer names:
// edit distance turns ordinary words (like/have) into crew names (Mike/Dave).
const ambiguousCrewWords = new Set(["will", "bill", "rob", "gene", "mark", "grant", "chase", "pat", "hope", "faith", "rose", "summer", "may", "april", "june", "art", "ray", "chip", "clay", "rich", "frank", "drew", "dusty", "guy", "max", "joy", "miles", "jack", "don", "hunter", "winter", "chance", "major", "angel"]);
function crewMentionTokens(body: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of body.matchAll(/[\p{L}]+(?:['’][\p{L}]+)*/gu)) {
    if (/['’]/.test(match[0]) || !/^[A-Z]/.test(match[0])) continue;
    const token = nameParts(match[0])[0];
    if (!token || token.length < 3) continue;
    if (ambiguousCrewWords.has(token)) {
      const before = body.slice(0, match.index).trimEnd();
      if (!/^[A-Z]/.test(match[0]) || !before || /[.!?]$/.test(before)) continue;
    }
    tokens.add(token);
  }
  return tokens;
}
function crewNameMentioned(first: string, tokens: Set<string>): boolean {
  if (tokens.has(first)) return true;
  return nicknameGroups.some(group => {
    const aliases = group.split(" ");
    return aliases.includes(first) && aliases.some(alias => tokens.has(alias));
  });
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

export const REVIEW_MATCHING_RULES_VERSION = "2026-10-21-rework-1";
// Nearest-rank p99 of 57 exact labels, measured 2026-10-21; below the 12h cap.
export const REVIEW_COMPLETION_TOLERANCE_MS = 6_612_000;
// Exclude common prose and junk-removal vocabulary; never expose matched words.
const contextStopWords = new Set("a an the and or of for to in on at by from with without this that these those my our your their his her they them was were is are be been very really great good excellent amazing professional friendly helpful quick fast efficient service services junk removal remove removed removing haul hauled hauling pickup pick picked clean cleanup cleanout cleaned cleaning job jobs team crew guys work worked working thanks thank recommend recommended would will had have has did done everything all it as so but not also came come get got out up us we you he she i me yard furniture couch sofa house home items stuff trash debris load truck appointment customer call called need needs please today yesterday street st road rd avenue ave drive dr lane ln boulevard blvd unit suite la louisiana".split(" "));
function contextTokens(text: string): Set<string> {
  return new Set(nameParts(text).filter(word => word.length >= 3 && /[a-z]/.test(word) && !contextStopWords.has(word)));
}
function eligibleAt(candidate: AppointmentCandidate, createdAt: string): boolean {
  const reviewDate = dateKey(createdAt);
  return candidate.completedAt !== null
    ? candidate.completedAt <= Date.parse(createdAt) + REVIEW_COMPLETION_TOLERANCE_MS
    : Boolean(reviewDate) && candidate.date <= reviewDate;
}

export function buildPodiumReviewNameSuggestionMap(
  dataDir: string,
  reviews: PodiumReviewNameSuggestionInput[],
): Record<string, PodiumReviewNameSuggestion[]> {
  const appointments = readAppointments(dataDir).filter(candidate => candidate.crew.length > 0)
    .map(candidate => ({ candidate, name: preparedName(candidate.customerName) }));
  return Object.fromEntries(reviews.map(review => {
    const reviewDate = dateKey(review.createdAt);
    if (!reviewDate) return [review.uid, []];
    const earliest = dateDaysBefore(reviewDate, 90), recent = dateDaysBefore(reviewDate, 14);
    const reviewer = preparedName(review.authorName);
    const words = crewMentionTokens(review.body || ""), context = contextTokens(review.body || "");
    const inviteName = review.invite?.customerName ? preparedName(review.invite.customerName) : null;
    const pool = appointments.filter(({ candidate: c }) => c.date >= earliest && eligibleAt(c, review.createdAt));
    const crewJobs = new Map<string, number>();
    for (const { candidate: c } of pool) if (c.date >= recent && sameTerritory(review.locationName, c.territory)) {
      for (const member of c.crew) crewJobs.set(member, (crewJobs.get(member) || 0) + 1);
    }
    const nameMatches = new Map<string, ReturnType<typeof nameMatchKind>>();
    const mentions = new Map<string, boolean>();
    const scored = pool.map(({ candidate: c, name }) => {
      const key = name.parts.join(" ");
      if (!nameMatches.has(key)) nameMatches.set(key, nameMatchKind(reviewer, name));
      const kind = nameMatches.get(key) ?? null;
      const days = Math.round((Date.parse(reviewDate) - Date.parse(c.date)) / 86_400_000);
      const unknownSameDay = days === 0 && c.completedAt === null;
      const timing = days < 0 ? 0 : days === 0 ? (unknownSameDay ? 20 : 30) : days <= 3 ? 20 : days <= 7 ? 10 : days <= 14 ? 3 : 0;
      const nameScore = kind ? { exact_name: 50, exact_first_last: 50, name_initial: 35, partial_name: 15, name_variation: 30 }[kind] : 0;
      const invite = Boolean(review.inviteNameReferences?.includes(c.appointmentId || c.jkNumber) || (inviteName && reviewer.parts.length >= 2 && reviewer.sorted === inviteName.sorted && ["exact_name", "exact_first_last"].includes(nameMatchKind(inviteName, name) || "")));
      const surname = reviewer.parts.length >= 2 ? reviewer.parts.at(-1)! : "";
      const email = Boolean(surname.length >= 3 && c.emailHandle.includes(surname));
      const overlaps = [...context].filter(word => c.contextTokens.has(word)).length;
      const evidence = [
        invite ? "Invite customer name matches reviewer and job" : "",
        kind ? { exact_name: "Exact customer name", exact_first_last: "First and last name", name_initial: "Name and initial", partial_name: "First or last name", name_variation: "Possible spelling or nickname variation" }[kind] : "",
        email ? "Reviewer name overlaps customer email handle" : "",
        timing ? (unknownSameDay ? "Completed same date; time unknown" : days === 0 ? "Completed same day" : `Completed ${days} day${days === 1 ? "" : "s"} before review`) : "",
        overlaps ? `${Math.min(overlaps, 2)} service context overlap${overlaps > 1 ? "s" : ""}` : "",
      ].filter(Boolean);
      let score = Number(invite) * 60 + nameScore + Number(email) * 35 + timing + Math.min(overlaps, 2) * 10;
      const crew = c.crew.filter(member => {
        if (!mentions.has(member)) mentions.set(member, crewNameMentioned(nameParts(member)[0] || "", words));
        return mentions.get(member);
      });
      const local = sameTerritory(review.locationName, c.territory);
      const uniqueCrew = c.date >= recent && local && crew.some(member => crewJobs.get(member) === 1);
      if (score > 0 || uniqueCrew) {
        if (crew.length) { score += Math.min(crew.length * 15, 25); evidence.push("Possible crew mention"); }
        if (local) { score += 5; evidence.push("Same location"); }
      }
      return { candidate: c, score, days, unknownSameDay, evidence, identity: invite || email || ["exact_name", "exact_first_last", "name_initial"].includes(kind || ""), matchKind: kind || (email ? "email_handle" : overlaps ? "context" : crew.length && uniqueCrew ? "crew_mention" : "timing") as PodiumReviewNameSuggestion["matchKind"] };
    });
    const short = scored.filter(entry => entry.candidate.date >= recent);
    const window = short.some(entry => entry.score >= 40) ? short : scored;
    window.sort((a, b) => b.score - a.score || b.candidate.date.localeCompare(a.candidate.date) || a.candidate.jkNumber.localeCompare(b.candidate.jkNumber));
    const runnerUp = scored.reduce((best, other) => other === window[0] ? best : Math.max(best, other.score), 0);
    let lows = 0;
    const suggestions = window.filter(entry => entry.score >= 15).map((entry, index) => {
      const high = index === 0 && entry.score >= 80 && entry.identity && !entry.unknownSameDay && entry.days >= 0 && entry.days <= 3 && entry.score - runnerUp >= 25;
      const confidence = high ? "High" : entry.score >= 40 ? "Medium" : "Low";
      return { ...assignmentOption(entry.candidate), matchKind: entry.matchKind, evidence: entry.evidence, score: entry.score, confidence, rulesVersion: REVIEW_MATCHING_RULES_VERSION } as PodiumReviewNameSuggestion;
    }).filter(entry => entry.confidence !== "Low" || ++lows <= 3);
    return [review.uid, suggestions];
  }));
}

/** Keep signal 2 across collector snapshots without persisting invite PII. */
export function buildPodiumInviteNameMatcher(dataDir: string) {
  const appointments = readAppointments(dataDir).map(candidate => ({ candidate, name: preparedName(candidate.customerName) }));
  return (review: PodiumReviewNameSuggestionInput): string[] => {
    const invite = review.invite?.customerName ? preparedName(review.invite.customerName) : null;
    const reviewer = preparedName(review.authorName);
    if (!invite || reviewer.parts.length < 2 || reviewer.sorted !== invite.sorted) return [];
    const earliest = dateDaysBefore(dateKey(review.createdAt), 90);
    return appointments.filter(({ candidate: c, name }) => c.crew.length && eligibleAt(c, review.createdAt) && c.date >= earliest
      && ["exact_name", "exact_first_last"].includes(nameMatchKind(invite, name) || ""))
      .map(({ candidate: c }) => c.appointmentId || c.jkNumber);
  };
}

export function podiumInviteNameReferences(dataDir: string, review: PodiumReviewNameSuggestionInput): string[] {
  return buildPodiumInviteNameMatcher(dataDir)(review);
}

export function inferredHighAttribution(suggestion: PodiumReviewNameSuggestion): PodiumReviewAppointmentAttribution {
  return {
    status: "matched", matchMethod: "inferred_high", appointmentId: suggestion.appointmentId,
    jkNumber: suggestion.jkNumber, appointmentDate: suggestion.appointmentDate,
    appointmentUrl: suggestion.appointmentUrl, territory: suggestion.territory,
    truck: suggestion.truck, crew: suggestion.crew, score: suggestion.score,
    reasons: suggestion.evidence, rulesVersion: suggestion.rulesVersion,
  };
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
    const email = normalizeEmail(invite?.channelIdentifier);
    const identifier = email || normalizePhone(invite?.channelIdentifier);
    if (!reviewDate || !identifier) return { status: "unmatched" };
    const method = email ? "exact_email" : "exact_phone";
    const earliestDate = dateDaysBefore(reviewDate, 90);
    const candidates = appointments.filter((appointment) =>
      appointment.crew.length > 0 && eligibleAt(appointment, reviewCreatedAt) && appointment.date >= earliestDate
      && appointment.identifiers.has(identifier));
    if (!candidates.length) return { status: "unmatched" };
    const latestDate = candidates.map((candidate) => candidate.date).sort().at(-1) || "";
    const latest = candidates.filter((candidate) => candidate.date === latestDate);
    return latest.length === 1 ? sanitizedMatch(latest[0], method) : { status: "ambiguous" };
  };
}

/** Local, aggregate-only calibration. Exact labels never enter inferred scoring. */
export function evaluatePodiumExactMatches(
  dataDir: string,
  reviews: Array<PodiumReviewNameSuggestionInput & { attribution?: PodiumReviewAppointmentAttribution }>,
) {
  const exact = [...new Map(reviews.filter(review => review.attribution?.status === "matched"
    && ["exact_phone", "exact_email"].includes(review.attribution.matchMethod || "")).map(review => [review.uid, review])).values()];
  const appointments = readAppointments(dataDir).filter(candidate => candidate.crew.length > 0);
  const inferred = buildPodiumReviewNameSuggestionMap(dataDir, exact);
  const deltas: number[] = [];
  const eligible = new Set<AppointmentCandidate>();
  let top1 = 0, top3 = 0, high = 0, wrongHigh = 0, resolved = 0;
  for (const review of exact) {
    const label = review.attribution!;
    const matches = (candidate: { appointmentId?: string; jkNumber?: string }) => label.appointmentId
      ? candidate.appointmentId === label.appointmentId
      : Boolean(label.jkNumber) && candidate.jkNumber === label.jkNumber;
    const job = appointments.find(matches);
    if (job) resolved++;
    if (job?.completedAt != null && Number.isFinite(Date.parse(review.createdAt))) deltas.push(job.completedAt - Date.parse(review.createdAt));
    const earliest = dateDaysBefore(dateKey(review.createdAt), 90);
    for (const candidate of appointments) if (earliest && candidate.date >= earliest && eligibleAt(candidate, review.createdAt)) eligible.add(candidate);
    const ranked = inferred[review.uid] || [];
    if (ranked[0] && matches(ranked[0])) top1++;
    if (ranked.slice(0, 3).some(matches)) top3++;
    if (ranked[0]?.confidence === "High") { high++; if (!matches(ranked[0])) wrongHigh++; }
  }
  deltas.sort((a, b) => a - b);
  // Nearest-rank percentiles over ALL usable exact labels, before chronology
  // filtering. Negative values are retained; tolerance cannot be negative.
  const percentile = (p: number) => deltas.length ? deltas[Math.max(0, Math.ceil(p * deltas.length) - 1)] : null;
  const p99 = percentile(0.99);
  const usable = [...eligible].filter(candidate => candidate.completedAt !== null).length;
  return {
    exactReviews: exact.length, resolvedExactJobs: resolved,
    top1, top3, top1Agreement: exact.length ? top1 / exact.length : null, top3Agreement: exact.length ? top3 / exact.length : null,
    high, wrongHigh, eligibleCandidates: eligible.size, candidatesWithCompletedAt: usable,
    completedAtShare: eligible.size ? usable / eligible.size : null,
    completionMinusReviewMs: { count: deltas.length, min: percentile(0), p50: percentile(0.5), p90: percentile(0.9), p95: percentile(0.95), p99, max: percentile(1) },
    recommendedToleranceMs: p99 === null ? 6 * 3_600_000 : Math.max(0, Math.min(12 * 3_600_000, p99)),
    appliedToleranceMs: REVIEW_COMPLETION_TOLERANCE_MS,
  };
}
