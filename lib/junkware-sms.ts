import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type JunkwareSmsEventKind = "new-appointment" | "cancellation" | "appointment-change" | "unknown";

export type JunkwareSmsEvent = {
  sequence: number;
  receivedAt: string;
  kind: JunkwareSmsEventKind;
  appointmentDates: string[];
  sender: string;
  text: string;
  bodyHash: string;
};

type JunkwareSmsState = {
  version: 1;
  sequence: number;
  lastReceivedAt: string | null;
  recentMessageSids: string[];
  events: JunkwareSmsEvent[];
};

const MAX_RECENT_EVENTS = 100;

function emptyState(): JunkwareSmsState {
  return {
    version: 1,
    sequence: 0,
    lastReceivedAt: null,
    recentMessageSids: [],
    events: [],
  };
}

export function junkwareSmsStateFile(): string {
  const configured = String(process.env.JUNKWARE_SMS_STATE_FILE || "").trim();
  return configured || path.join(process.cwd(), "data", "integrations", "junkware-sms", "state.json");
}

function validDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function normalizeState(value: unknown): JunkwareSmsState {
  if (!value || typeof value !== "object") return emptyState();
  const candidate = value as Partial<JunkwareSmsState>;
  const sequence = Number.isSafeInteger(candidate.sequence) && Number(candidate.sequence) >= 0
    ? Number(candidate.sequence)
    : 0;
  const events = Array.isArray(candidate.events)
    ? candidate.events.flatMap((event) => {
      if (!event || typeof event !== "object") return [];
      const item = event as Partial<JunkwareSmsEvent>;
      const itemSequence = Number(item.sequence);
      if (!Number.isSafeInteger(itemSequence) || itemSequence < 1 || itemSequence > sequence) return [];
      const kind: JunkwareSmsEventKind = ["new-appointment", "cancellation", "appointment-change", "unknown"].includes(String(item.kind))
        ? item.kind as JunkwareSmsEventKind
        : "unknown";
      return [{
        sequence: itemSequence,
        receivedAt: String(item.receivedAt || ""),
        kind,
        appointmentDates: Array.isArray(item.appointmentDates)
          ? item.appointmentDates.map(String).filter(validDateKey)
          : [],
        sender: String(item.sender || ""),
        text: String(item.text || ""),
        bodyHash: String(item.bodyHash || ""),
      }];
    }).slice(-MAX_RECENT_EVENTS)
    : [];

  return {
    version: 1,
    sequence,
    lastReceivedAt: candidate.lastReceivedAt ? String(candidate.lastReceivedAt) : null,
    recentMessageSids: Array.isArray(candidate.recentMessageSids)
      ? candidate.recentMessageSids.map(String).filter(Boolean).slice(-MAX_RECENT_EVENTS)
      : [],
    events,
  };
}

export function readJunkwareSmsState(): JunkwareSmsState {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(junkwareSmsStateFile(), "utf8")));
  } catch {
    return emptyState();
  }
}

function writeJunkwareSmsState(state: JunkwareSmsState): void {
  const target = junkwareSmsStateFile();
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function chicagoDateParts(reference: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function dateKey(year: number, month: number, day: number): string | null {
  const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validDateKey(candidate) ? candidate : null;
}

function inferredYear(month: number, day: number, reference: Date): number {
  const today = chicagoDateParts(reference);
  const current = Date.UTC(today.year, today.month - 1, today.day);
  const candidate = Date.UTC(today.year, month - 1, day);
  return candidate < current - 180 * 24 * 60 * 60 * 1000 ? today.year + 1 : today.year;
}

export function extractAppointmentDates(body: string, reference = new Date()): string[] {
  const found = new Set<string>();
  const add = (year: number, month: number, day: number) => {
    const value = dateKey(year, month, day);
    if (value) found.add(value);
  };

  for (const match of body.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) {
    add(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  for (const match of body.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/g)) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    const rawYear = match[3] ? Number(match[3]) : inferredYear(month, day, reference);
    add(rawYear < 100 ? 2000 + rawYear : rawYear, month, day);
  }

  const monthNumbers: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12,
  };
  const monthPattern = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
  const namedDate = new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, "gi");
  for (const match of body.matchAll(namedDate)) {
    const month = monthNumbers[String(match[1]).toLowerCase()];
    const day = Number(match[2]);
    add(match[3] ? Number(match[3]) : inferredYear(month, day, reference), month, day);
  }

  return [...found].sort();
}

export function classifyJunkwareSms(body: string): JunkwareSmsEventKind {
  const normalized = body.toLowerCase();
  if (/\bcancel(?:led|ed|ation|ing)?\b/.test(normalized)) return "cancellation";
  if (/\b(?:new|created|booked)\b[\s\S]{0,40}\b(?:appointment|job|booking)\b|\b(?:appointment|job|booking)\b[\s\S]{0,40}\b(?:new|created|booked)\b/.test(normalized)) {
    return "new-appointment";
  }
  if (/\b(?:rescheduled|changed|updated|modified)\b/.test(normalized)) return "appointment-change";
  return "unknown";
}

export function recordJunkwareSms(input: {
  messageSid: string;
  body: string;
  sender?: string;
  receivedAt?: Date;
}): { duplicate: boolean; event: JunkwareSmsEvent | null; state: JunkwareSmsState } {
  const state = readJunkwareSmsState();
  const messageSid = String(input.messageSid || "").trim();
  const receivedAt = input.receivedAt || new Date();
  const body = String(input.body || "");
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const deduplicationKey = messageSid || `message-${receivedAt.toISOString()}-${bodyHash}`;
  if (state.recentMessageSids.includes(deduplicationKey)) {
    return { duplicate: true, event: null, state };
  }

  const event: JunkwareSmsEvent = {
    sequence: state.sequence + 1,
    receivedAt: receivedAt.toISOString(),
    kind: classifyJunkwareSms(body),
    appointmentDates: extractAppointmentDates(body, receivedAt),
    sender: String(input.sender || "").trim(),
    text: body,
    bodyHash,
  };
  const nextState: JunkwareSmsState = {
    version: 1,
    sequence: event.sequence,
    lastReceivedAt: event.receivedAt,
    recentMessageSids: [...state.recentMessageSids, deduplicationKey].slice(-MAX_RECENT_EVENTS),
    events: [...state.events, event].slice(-MAX_RECENT_EVENTS),
  };
  writeJunkwareSmsState(nextState);
  return { duplicate: false, event, state: nextState };
}

export function junkwareSmsEventsAfter(after: number): { sequence: number; lastReceivedAt: string | null; events: JunkwareSmsEvent[] } {
  const state = readJunkwareSmsState();
  return {
    sequence: state.sequence,
    lastReceivedAt: state.lastReceivedAt,
    events: state.events.filter((event) => event.sequence > after),
  };
}

export function secureTokenMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}
