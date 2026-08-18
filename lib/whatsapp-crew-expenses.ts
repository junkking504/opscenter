import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chicagoDateKey } from "@/lib/report-dates";
import { normalizePhone } from "@/lib/whatsapp-job-photo-matching";
import type { WhatsAppInboundMessage, WhatsAppTextMessage } from "@/lib/whatsapp-job-photo-queue";

export type CrewExpenseKind = "dump" | "fuel";

export type CrewExpenseRecord = {
  version: 1;
  messageId: string;
  kind: CrewExpenseKind;
  date: string;
  truck: string;
  location: string;
  cost: number;
  weight: string | null;
  gallons: number | null;
  time: string;
  reportedAt: string;
  senderHash: string;
  source: "whatsapp_opsbot";
  sourceMessageIds?: string[];
};

export type CrewExpenseIngestResult = {
  status: "ignored" | "duplicate" | "prompted" | "collecting" | "queued" | "review";
  kind?: CrewExpenseKind;
  record?: CrewExpenseRecord;
  missing?: string[];
};

type CrewExpenseReply = {
  version: 1;
  messageId: string;
  recipient: string;
  phoneNumberId: string;
  text: string;
  enqueuedAt: string;
  attempts?: number;
};

export type CrewExpenseTransaction = {
  version: 1;
  record: CrewExpenseRecord;
  recipient: string;
  phoneNumberId: string;
  stage: "pending_junkware" | "junkware_verified" | "slack_sent";
  enqueuedAt: string;
  attempts?: number;
  lastAttemptAt?: string;
  lastError?: string;
  junkware?: Record<string, unknown>;
  slack?: Record<string, unknown>;
};

type CrewExpenseFields = Partial<Record<"truck" | "location" | "cost" | "weight" | "gallons", string>>;

type CrewExpenseSession = {
  version: 1;
  kind: CrewExpenseKind;
  openedAt: string;
  updatedAt: string;
  fields: CrewExpenseFields;
  messageIds: string[];
};

const DUMP_TEMPLATE = [
  "Truck 1",
  "Gentilly Landfill",
  "$86.40",
  "2 tons",
].join("\n");

const FUEL_TEMPLATE = [
  "Truck 1",
  "Shell",
  "24 gallons",
  "$100",
].join("\n");

const SESSION_MAX_IDLE_MS = 12 * 60 * 60 * 1_000;

function clean(value: unknown): string {
  return String(value || "").replace(/[ \t]+/g, " ").trim();
}

function editDistance(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function nearWord(value: string, expected: string, maximumDistance = 1): boolean {
  const normalized = value.toLowerCase();
  if (normalized === expected) return true;
  if (normalized.length < 4 || expected.length < 4 || normalized[0] !== expected[0]) return false;
  if (normalized.length === expected.length) {
    for (let index = 0; index < normalized.length - 1; index += 1) {
      const swapped = `${normalized.slice(0, index)}${normalized[index + 1]}${normalized[index]}${normalized.slice(index + 2)}`;
      if (swapped === expected) return true;
    }
  }
  return editDistance(normalized, expected) <= maximumDistance;
}

function canonicalizeStructuredTerms(text: string): string {
  return String(text || "")
    .replace(/\b[a-z]+\b/gi, (word) => {
      const lower = word.toLowerCase();
      if (nearWord(lower, "truck")) return "truck";
      if (nearWord(lower, "dump") || nearWord(lower, "dumps")) return "dump";
      if (nearWord(lower, "fuel")) return "fuel";
      if (nearWord(lower, "gallon", 2) || nearWord(lower, "gallons", 2)) return "gallons";
      if (nearWord(lower, "pound") || nearWord(lower, "pounds")) return "pounds";
      if (nearWord(lower, "kilogram", 2) || nearWord(lower, "kilograms", 2)) return "kilograms";
      return word;
    })
    .replace(/^(\s*)([a-z]+)(\s*:)/gim, (match, prefix: string, label: string, suffix: string) => {
      const labels = ["truck", "location", "cost", "weight", "gallons"];
      const candidates = labels
        .map((candidate) => ({ candidate, distance: editDistance(label, candidate) }))
        .filter(({ candidate, distance }) => label[0]?.toLowerCase() === candidate[0] && distance <= (candidate.length >= 7 ? 2 : 1))
        .sort((left, right) => left.distance - right.distance);
      return candidates.length && (candidates.length === 1 || candidates[0].distance < candidates[1].distance)
        ? `${prefix}${candidates[0].candidate}${suffix}`
        : match;
    });
}

const KNOWN_EXPENSE_LOCATIONS: Record<CrewExpenseKind, string[]> = {
  dump: ["Gentilly", "Gentilly Landfill", "River Birch", "EBR"],
  fuel: ["Shell", "Exxon", "Chevron", "Circle K", "RaceTrac", "Pilot", "Costco", "Sam's Club"],
};

function canonicalLocation(value: string, kind: CrewExpenseKind): string {
  const location = clean(value);
  const normalized = location.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return location;
  const candidates = KNOWN_EXPENSE_LOCATIONS[kind]
    .map((candidate) => ({
      candidate,
      distance: editDistance(normalized, candidate.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()),
    }))
    .filter(({ candidate, distance }) => {
      const expected = candidate.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const maximum = expected.length >= 12 ? 3 : expected.length >= 7 ? 2 : 1;
      return normalized[0] === expected[0] && distance <= maximum;
    })
    .sort((left, right) => left.distance - right.distance);
  return candidates.length && (candidates.length === 1 || candidates[0].distance < candidates[1].distance)
    ? candidates[0].candidate
    : location;
}

function recordKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stateDirectory(): string {
  const configured = clean(process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR);
  if (configured) return configured;
  const dataDirectory = clean(process.env.OPSBOT_DATA_DIR);
  if (dataDirectory) return path.join(dataDirectory, "integrations", "whatsapp-crew-expenses");
  return path.join(process.cwd(), "data", "integrations", "whatsapp-crew-expenses");
}

type CrewExpenseDirectory = "messages" | "records" | "review" | "sessions"
  | "transactions-pending" | "transactions-processing" | "transactions-completed" | "transactions-failed"
  | "outbox-incoming" | "outbox-processing" | "outbox-sent" | "outbox-failed";

function directory(name: CrewExpenseDirectory): string {
  return path.join(stateDirectory(), name);
}

function ensureDirectories(): void {
  for (const name of [
    "messages", "records", "review", "sessions",
    "transactions-pending", "transactions-processing", "transactions-completed", "transactions-failed",
    "outbox-incoming", "outbox-processing", "outbox-sent", "outbox-failed",
  ] as const) {
    fs.mkdirSync(directory(name), { recursive: true, mode: 0o700 });
  }
}

function writeJsonAtomic(target: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function messageFile(messageId: string): string {
  return path.join(directory("messages"), `${recordKey(messageId)}.json`);
}

function normalizeTruck(value: string): string | null {
  const match = clean(value).match(/^(?:(?:truck|t)\s*#?\s*)?(\d{1,3})$/i);
  if (!match) return null;
  const number = Number(match[1]);
  return number > 0 ? `Truck# ${number}` : null;
}

function parseMoney(value: string): number | null {
  const normalized = clean(value)
    .replace(/\b(?:usd|dollars?)\b/gi, "")
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/[.!?]+$/, "")
    .trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 && amount <= 25_000 ? Math.round(amount * 100) / 100 : null;
}

function parseGallons(value: string): number | null {
  const normalized = clean(value)
    .replace(/^\s*(?:gal(?:lon)?s?|g)\s*/i, "")
    .replace(/\s*(?:gal(?:lon)?s?|g)\.?\s*$/i, "")
    .replace(/[:#-]/g, "")
    .trim()
    .replace(/\.$/, "");
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null;
  const gallons = Number(normalized);
  return Number.isFinite(gallons) && gallons > 0 && gallons <= 500 ? gallons : null;
}

function formatTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function chicagoTime(receivedAt: string): string | null {
  const date = new Date(receivedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? formatTime(hour, minute) : null;
}

function commandKind(text: string): CrewExpenseKind | null {
  const command = clean(text).toLowerCase();
  if (/^dump(?:\s+(?:run|expense))?$/.test(command)) return "dump";
  if (/^(?:fuel|gas)(?:\s+(?:fill-?up|expense))?$/.test(command)) return "fuel";
  return null;
}

function stripReportedTime(value: string): string {
  return clean(value.replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:[ap]\.?m\.?)?\b|\b\d{3,4}\s*[ap]\.?m\.?\b/gi, " "));
}

function stripCompactTimeTokens(value: string): string {
  return clean(value.replace(/\b\d{3,4}\b/g, " "));
}

function messageHeading(lines: string[]): CrewExpenseKind | null {
  if (!lines.length) return null;
  const first = clean(lines[0]).toLowerCase();
  if (first === "dump") return "dump";
  if (first === "fuel" || first === "gas") return "fuel";
  return null;
}

function fieldsFromMessage(text: string): { fields: CrewExpenseFields; recognized: boolean; lines: string[] } {
  const fields: CrewExpenseFields = {};
  const lines = String(text || "").split(/\r?\n/).map(clean).filter(Boolean);
  let recognized = false;
  for (const line of lines) {
    const match = line.match(/^(truck\s*#?|location|cost|weight|gallons?)\s*:\s*(.*)$/i);
    if (!match) continue;
    const rawKey = match[1].toLowerCase().replace(/\s+/g, "");
    const key: keyof CrewExpenseFields = rawKey === "truck#" || rawKey === "truck"
      ? "truck"
      : rawKey.startsWith("gallon")
        ? "gallons"
        : rawKey as keyof CrewExpenseFields;
    fields[key] = clean(match[2]);
    recognized = true;
  }
  return { fields, recognized, lines };
}

function explicitKind(text: string): CrewExpenseKind | null {
  if (/\bdump\b/i.test(text)) return "dump";
  if (/\b\d+(?:\.\d{1,3})?\s*(?:g|gal(?:lon)?s?)\.?\b/i.test(text)) return "fuel";
  if (/\bgal(?:lon)?s?\s*[:#-]?\s*\d+(?:\.\d{1,3})?\b/i.test(text)) return "fuel";
  if (/\b(?:fuel|gas)\b/i.test(text)) return "fuel";
  if (/\b\d+(?:\.\d+)?\s*(?:tons?|lbs?|pounds?|kg|kgs|kilograms?)\.?\b/i.test(text)) return "dump";
  if (/\b(?:tons?|lbs?|pounds?|kg|kgs|kilograms?)\s*[:#-]?\s*\d+(?:\.\d+)?\b/i.test(text)) return "dump";
  return null;
}

function freeformKind(text: string): CrewExpenseKind | null {
  const explicit = explicitKind(text);
  if (explicit) return explicit;
  const truck = text.match(/\b(?:truck|t)\s*#?\s*\d{1,3}\b/i)?.[0] || "";
  if (!truck) return null;
  let remainder = stripReportedTime(text.replace(truck, " "));
  const markedCost = remainder.match(/\$\s*\d[\d,]*(?:\.\d{0,2})?/i)?.[0]
    || remainder.match(/\b\d[\d,]*(?:\.\d{1,2})?\s*\$/i)?.[0]
    || remainder.match(/\b(?:usd|dollars?)\s*[:#-]?\s*\d[\d,]*(?:\.\d{1,2})?\b/i)?.[0]
    || remainder.match(/\b\d[\d,]*(?:\.\d{1,2})?\s*(?:usd|dollars?)\b/i)?.[0]
    || "";
  let plainCosts = [...remainder.matchAll(/\b\d[\d,]*(?:\.\d{1,2})?\b/g)]
    .map((match) => match[0])
    .filter((candidate) => parseMoney(candidate) !== null);
  const compactTime = plainCosts.length === 2 ? plainCosts.find((candidate) => /^\d{3,4}$/.test(candidate)) : undefined;
  if (!markedCost && compactTime) {
    remainder = clean(remainder.replace(new RegExp(`\\b${compactTime}\\b`), " "));
    plainCosts = plainCosts.filter((candidate) => candidate !== compactTime);
  }
  const cost = markedCost || (plainCosts.length === 1 ? plainCosts[0] : "");
  if (!cost || parseMoney(cost) === null) return null;
  const location = clean(remainder.replace(cost, " ").replace(/[|/,;:@-]+/g, " "));
  const canonical = canonicalLocation(location, "dump");
  return canonical !== location || KNOWN_EXPENSE_LOCATIONS.dump.some((candidate) => candidate.toLowerCase() === location.toLowerCase())
    ? "dump"
    : null;
}

function freeformFields(
  lines: string[],
  kind: CrewExpenseKind,
  existing: CrewExpenseFields,
): CrewExpenseFields {
  const fields: CrewExpenseFields = {};
  for (const rawLine of lines) {
    const line = clean(rawLine);
    if (!line || /^(?:fuel|gas|dump)$/i.test(line)) continue;
    if (/^time\s*:/i.test(line)) continue;
    let remainder = line;
    const take = (key: keyof CrewExpenseFields, pattern: RegExp): void => {
      if (existing[key] || fields[key]) return;
      const match = remainder.match(pattern);
      if (!match) return;
      fields[key] = clean(match[0]);
      remainder = clean(`${remainder.slice(0, match.index)} ${remainder.slice((match.index || 0) + match[0].length)}`);
    };

    take("truck", /\b(?:truck|t)\s*#?\s*\d{1,3}\b/i);
    if (kind === "fuel") {
      take("gallons", /\b\d+(?:\.\d{1,3})?\s*(?:g|gal(?:lon)?s?)\.?\b/i);
      take("gallons", /\bgal(?:lon)?s?\s*[:#-]?\s*\d+(?:\.\d{1,3})?\b/i);
    }
    take("cost", /\$\s*\d[\d,]*(?:\.\d{0,2})?/i);
    take("cost", /\b\d[\d,]*(?:\.\d{1,2})?\s*\$/i);
    take("cost", /\b(?:usd|dollars?)\s*[:#-]?\s*\d[\d,]*(?:\.\d{1,2})?\b/i);
    take("cost", /\b\d[\d,]*(?:\.\d{1,2})?\s*(?:usd|dollars?)\b/i);
    if (kind === "dump") {
      take("weight", /\b\d+(?:\.\d+)?\s*(?:tons?|lbs?|pounds?|kg|kgs|kilograms?)\.?\b/i);
      take("weight", /\b(?:tons?|lbs?|pounds?|kg|kgs|kilograms?)\s*[:#-]?\s*\d+(?:\.\d+)?\b/i);
    }

    // A formerly supported, user-entered time may still appear in a message.
    // It is deliberately ignored: the inbound WhatsApp timestamp is authoritative.
    remainder = stripReportedTime(remainder);
    if (existing.cost || fields.cost) remainder = stripCompactTimeTokens(remainder);

    if (kind === "dump" && !existing.cost && !fields.cost) {
      let plainCosts = [...remainder.matchAll(/\b\d[\d,]*(?:\.\d{1,2})?\b/g)]
        .map((match) => match[0])
        .filter((candidate) => parseMoney(candidate) !== null);
      const compactTime = plainCosts.length === 2 ? plainCosts.find((candidate) => /^\d{3,4}$/.test(candidate)) : undefined;
      if (compactTime) {
        remainder = clean(remainder.replace(new RegExp(`\\b${compactTime}\\b`), " "));
        plainCosts = plainCosts.filter((candidate) => candidate !== compactTime);
      }
      if (plainCosts.length === 1) {
        fields.cost = plainCosts[0];
        remainder = clean(remainder.replace(plainCosts[0], " "));
      }
    }

    remainder = remainder
      .replace(/\b(?:fuel|gas|dump|filled|fill|up|got|purchased|bought|paid|cost|time|at|from|for)\b/gi, " ")
      .replace(/[|/,;:@-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!existing.location && !fields.location && remainder.length >= 2 && remainder.length <= 120) {
      fields.location = remainder;
    }
  }
  return fields;
}

function sessionFile(senderPhone: string): string {
  return path.join(directory("sessions"), `${recordKey(normalizePhone(senderPhone))}.json`);
}

function activeSession(senderPhone: string, receivedAt: string): CrewExpenseSession | null {
  try {
    const payload = JSON.parse(fs.readFileSync(sessionFile(senderPhone), "utf8")) as Partial<CrewExpenseSession>;
    const openedAt = new Date(String(payload.openedAt || "")).getTime();
    const updatedAt = new Date(String(payload.updatedAt || payload.openedAt || "")).getTime();
    const messageAt = new Date(receivedAt).getTime();
    if (!Number.isFinite(openedAt) || !Number.isFinite(updatedAt) || !Number.isFinite(messageAt) || messageAt < openedAt - 60_000 || messageAt - updatedAt > SESSION_MAX_IDLE_MS) return null;
    if (payload.kind !== "dump" && payload.kind !== "fuel") return null;
    return {
      version: 1,
      kind: payload.kind,
      openedAt: String(payload.openedAt),
      updatedAt: String(payload.updatedAt || payload.openedAt),
      fields: payload.fields && typeof payload.fields === "object" ? payload.fields : {},
      messageIds: Array.isArray(payload.messageIds) ? payload.messageIds.map(String) : [],
    };
  } catch {
    return null;
  }
}

function openSession(message: WhatsAppTextMessage, kind: CrewExpenseKind): void {
  const session: CrewExpenseSession = {
    version: 1,
    kind,
    openedAt: message.receivedAt,
    updatedAt: message.receivedAt,
    fields: {},
    messageIds: [message.messageId],
  };
  writeJsonAtomic(sessionFile(message.senderPhone), session);
}

function updateSession(message: WhatsAppTextMessage, session: CrewExpenseSession, fields: CrewExpenseFields): CrewExpenseSession {
  const updated = {
    ...session,
    updatedAt: message.receivedAt,
    fields,
    messageIds: [...new Set([...session.messageIds, message.messageId])],
  };
  writeJsonAtomic(sessionFile(message.senderPhone), updated);
  return updated;
}

function closeSession(senderPhone: string): void {
  try { fs.unlinkSync(sessionFile(senderPhone)); } catch { /* no active session */ }
}

function enqueueReply(message: Pick<WhatsAppInboundMessage, "messageId" | "senderPhone" | "phoneNumberId">, text: string, purpose = "expense"): void {
  const recipient = normalizePhone(message.senderPhone);
  if (!recipient) return;
  const fileName = `${recordKey(`${message.messageId}:${purpose}`)}.json`;
  for (const queue of ["outbox-incoming", "outbox-processing", "outbox-sent", "outbox-failed"] as const) {
    if (fs.existsSync(path.join(directory(queue), fileName))) return;
  }
  const reply: CrewExpenseReply = {
    version: 1,
    messageId: message.messageId,
    recipient,
    phoneNumberId: clean(message.phoneNumberId),
    text: String(text).slice(0, 4_000),
    enqueuedAt: new Date().toISOString(),
  };
  writeJsonAtomic(path.join(directory("outbox-incoming"), fileName), reply);
}

export function enqueueOpsBotReply(
  message: Pick<WhatsAppInboundMessage, "messageId" | "senderPhone" | "phoneNumberId">,
  text: string,
  purpose: string,
): void {
  ensureDirectories();
  enqueueReply(message, text, purpose);
}

export function enqueueCrewExpenseReceipt(message: WhatsAppInboundMessage): void {
  ensureDirectories();
  enqueueReply(message, "Recorded.", "receipt");
}

function missingReply(kind: CrewExpenseKind, missing: string[], invalid: string[]): string {
  const problems = [
    ...(missing.length ? [`Missing: ${missing.join(", ")}.`] : []),
    ...(invalid.length ? [`Check: ${invalid.join(", ")}.`] : []),
  ].join(" ");
  const guidance = kind === "dump"
    ? "Weight is optional. The transaction time is the time you send this message to OpsBot."
    : "Gallons is required. The transaction time is the time you send this message to OpsBot.";
  return `${problems} ${guidance}\n\n${kind === "dump" ? DUMP_TEMPLATE : FUEL_TEMPLATE}`.trim();
}

export function ingestCrewExpenseText(message: WhatsAppTextMessage): CrewExpenseIngestResult {
  ensureDirectories();
  const marker = messageFile(message.messageId);
  if (fs.existsSync(marker)) return { status: "duplicate" };

  const normalizedMessage = { ...message, text: canonicalizeStructuredTerms(message.text) };

  const command = commandKind(normalizedMessage.text);
  if (command) {
    openSession(normalizedMessage, command);
    enqueueReply(normalizedMessage, `Send each item separately or all at once — no labels needed. OpsBot uses the time you send the completed expense as its transaction time:\n\n${command === "dump" ? DUMP_TEMPLATE : FUEL_TEMPLATE}${command === "dump" ? "\n\nWeight is optional." : ""}`, "expense-prompt");
    writeJsonAtomic(marker, { version: 1, messageId: message.messageId, outcome: "prompted", kind: command, processedAt: new Date().toISOString() });
    return { status: "prompted", kind: command };
  }

  const parsed = fieldsFromMessage(normalizedMessage.text);
  const heading = messageHeading(parsed.lines);
  const explicit = parsed.fields.gallons ? "fuel" : parsed.fields.weight ? "dump" : explicitKind(normalizedMessage.text);
  const inferred = explicit || freeformKind(normalizedMessage.text);
  const session = activeSession(message.senderPhone, message.receivedAt);
  const kind = heading || explicit || session?.kind || inferred;
  if (!parsed.recognized && !kind) return { status: "ignored" };
  if (!kind) {
    const detail = "Start with Dump or Fuel so OpsBot knows which expense form you are sending.";
    enqueueReply(message, `${detail}\n\nSend Dump or Fuel to get the form.`, "expense-review");
    writeJsonAtomic(path.join(directory("review"), `${recordKey(message.messageId)}.json`), {
      version: 1, messageId: message.messageId, reason: "expense_type_missing", reportedAt: message.receivedAt,
    });
    writeJsonAtomic(marker, { version: 1, messageId: message.messageId, outcome: "review", reason: "expense_type_missing", processedAt: new Date().toISOString() });
    return { status: "review" };
  }

  const previousFields = session?.kind === kind ? session.fields : {};
  const inferredFields = freeformFields(parsed.lines, kind, { ...previousFields, ...parsed.fields });
  const fields = { ...previousFields, ...parsed.fields, ...inferredFields };
  const currentSession = session?.kind === kind
    ? updateSession(message, session, fields)
    : null;

  const required = kind === "dump" ? ["truck", "location", "cost"] : ["truck", "location", "cost", "gallons"];
  const missing = required.filter((key) => !fields[key as keyof CrewExpenseFields]);
  const truck = fields.truck ? normalizeTruck(fields.truck) : null;
  const cost = fields.cost ? parseMoney(fields.cost) : null;
  const gallons = kind === "fuel" && fields.gallons ? parseGallons(fields.gallons) : null;
  const time = chicagoTime(message.receivedAt);
  const invalid = [
    ...(fields.truck && !truck ? ["Truck"] : []),
    ...(fields.location && (fields.location.length < 2 || fields.location.length > 120) ? ["Location"] : []),
    ...(fields.cost && cost === null ? ["Cost"] : []),
    ...(kind === "fuel" && fields.gallons && gallons === null ? ["Gallons"] : []),
    ...(time === null ? ["Message timestamp"] : []),
  ];

  if (missing.length || invalid.length || !truck || cost === null || !time || (kind === "fuel" && gallons === null)) {
    if (currentSession && invalid.length === 0) {
      writeJsonAtomic(marker, {
        version: 1, messageId: message.messageId, outcome: "collecting", kind,
        collected: Object.keys(inferredFields), processedAt: new Date().toISOString(),
      });
      return { status: "collecting", kind, missing };
    }
    const reply = missingReply(kind, missing.map((key) => key === "truck" ? "Truck #" : key[0].toUpperCase() + key.slice(1)), invalid);
    enqueueReply(message, reply, "expense-review");
    writeJsonAtomic(path.join(directory("review"), `${recordKey(message.messageId)}.json`), {
      version: 1, messageId: message.messageId, kind, reason: "invalid_or_incomplete_form", missing, invalid,
      reportedAt: message.receivedAt, senderHash: recordKey(normalizePhone(message.senderPhone)),
    });
    writeJsonAtomic(marker, { version: 1, messageId: message.messageId, outcome: "review", kind, processedAt: new Date().toISOString() });
    return { status: "review", kind, missing };
  }

  const record: CrewExpenseRecord = {
    version: 1,
    messageId: message.messageId,
    kind,
    date: chicagoDateKey(new Date(message.receivedAt)),
    truck,
    location: canonicalLocation(fields.location || "", kind),
    cost,
    weight: kind === "dump" ? clean(fields.weight) || null : null,
    gallons: kind === "fuel" ? gallons : null,
    time,
    reportedAt: message.receivedAt,
    senderHash: recordKey(normalizePhone(message.senderPhone)),
    source: "whatsapp_opsbot",
    sourceMessageIds: currentSession?.messageIds,
  };
  const transaction: CrewExpenseTransaction = {
    version: 1,
    record,
    recipient: normalizePhone(message.senderPhone),
    phoneNumberId: clean(message.phoneNumberId),
    stage: "pending_junkware",
    enqueuedAt: new Date().toISOString(),
  };
  writeJsonAtomic(path.join(directory("transactions-pending"), `${recordKey(message.messageId)}.json`), transaction);
  writeJsonAtomic(marker, { version: 1, messageId: message.messageId, outcome: "queued", kind, processedAt: new Date().toISOString() });
  closeSession(message.senderPhone);
  return { status: "queued", kind, record };
}

export function queuedCrewExpenseTransactions(limit = 10): string[] {
  ensureDirectories();
  return fs.readdirSync(directory("transactions-pending"))
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .sort()
    .slice(0, Math.max(0, limit))
    .map((name) => path.join(directory("transactions-pending"), name));
}

export function claimCrewExpenseTransaction(incomingFile: string): { file: string; transaction: CrewExpenseTransaction } | null {
  ensureDirectories();
  const base = path.basename(incomingFile);
  if (!/^[a-f0-9]{64}\.json$/.test(base)) return null;
  const processingFile = path.join(directory("transactions-processing"), base);
  try {
    fs.renameSync(incomingFile, processingFile);
    return { file: processingFile, transaction: JSON.parse(fs.readFileSync(processingFile, "utf8")) as CrewExpenseTransaction };
  } catch {
    return null;
  }
}

export function updateCrewExpenseTransaction(processingFile: string, update: Partial<CrewExpenseTransaction>): CrewExpenseTransaction {
  const current = JSON.parse(fs.readFileSync(processingFile, "utf8")) as CrewExpenseTransaction;
  const next = { ...current, ...update };
  writeJsonAtomic(processingFile, next);
  return next;
}

export function finishCrewExpenseTransaction(processingFile: string): CrewExpenseRecord {
  const transaction = JSON.parse(fs.readFileSync(processingFile, "utf8")) as CrewExpenseTransaction;
  if (transaction.stage !== "slack_sent") throw new Error("The crew expense cannot appear in OpsCenter before Slack delivery.");
  writeJsonAtomic(path.join(directory("records"), `${recordKey(transaction.record.messageId)}.json`), transaction.record);
  const completedFile = path.join(directory("transactions-completed"), path.basename(processingFile));
  writeJsonAtomic(completedFile, { ...transaction, completedAt: new Date().toISOString() });
  const detail = transaction.record.kind === "dump"
    ? `${transaction.record.weight ? ` · ${transaction.record.weight}` : " · no weight"}`
    : ` · ${transaction.record.gallons} gal`;
  enqueueReply({
    messageId: transaction.record.messageId,
    senderPhone: transaction.recipient,
    phoneNumberId: transaction.phoneNumberId,
  }, `${transaction.record.kind === "dump" ? "Dump" : "Fuel"} verified in JunkWare — ${transaction.record.truck} · ${transaction.record.location} · $${transaction.record.cost.toFixed(2)}${detail} · ${transaction.record.time}\n\nNeed to fix something? Reply EDIT.`, "expense-verified");
  fs.unlinkSync(processingFile);
  return transaction.record;
}

export function requeueCrewExpenseTransaction(processingFile: string, errorMessage: string, maxAttempts = 1_000): boolean {
  const current = JSON.parse(fs.readFileSync(processingFile, "utf8")) as CrewExpenseTransaction;
  const attempts = Math.max(0, Number(current.attempts) || 0) + 1;
  if (attempts >= maxAttempts) {
    const target = path.join(directory("transactions-failed"), path.basename(processingFile));
    writeJsonAtomic(target, { ...current, attempts, failedAt: new Date().toISOString(), lastError: clean(errorMessage).slice(0, 500) });
    fs.unlinkSync(processingFile);
    return false;
  }
  writeJsonAtomic(path.join(directory("transactions-pending"), path.basename(processingFile)), {
    ...current, attempts, lastAttemptAt: new Date().toISOString(), lastError: clean(errorMessage).slice(0, 500),
  });
  fs.unlinkSync(processingFile);
  return true;
}

export function readCrewExpenseRecords(date?: string): CrewExpenseRecord[] {
  ensureDirectories();
  return fs.readdirSync(directory("records"))
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .flatMap((name) => {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(directory("records"), name), "utf8")) as CrewExpenseRecord;
        return !date || record.date === date ? [record] : [];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.reportedAt.localeCompare(left.reportedAt));
}

export function queuedCrewExpenseReplies(limit = 20): string[] {
  ensureDirectories();
  return fs.readdirSync(directory("outbox-incoming"))
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .sort()
    .slice(0, Math.max(0, limit))
    .map((name) => path.join(directory("outbox-incoming"), name));
}

export function claimCrewExpenseReply(incomingFile: string): { file: string; reply: CrewExpenseReply } | null {
  ensureDirectories();
  const base = path.basename(incomingFile);
  if (!/^[a-f0-9]{64}\.json$/.test(base)) return null;
  const processingFile = path.join(directory("outbox-processing"), base);
  try {
    fs.renameSync(incomingFile, processingFile);
    return { file: processingFile, reply: JSON.parse(fs.readFileSync(processingFile, "utf8")) as CrewExpenseReply };
  } catch {
    return null;
  }
}

export function finishCrewExpenseReply(processingFile: string, outcome: "sent" | "failed", details: Record<string, unknown>): void {
  const current = JSON.parse(fs.readFileSync(processingFile, "utf8"));
  const target = path.join(directory(outcome === "sent" ? "outbox-sent" : "outbox-failed"), path.basename(processingFile));
  writeJsonAtomic(target, { ...current, outcome, outcomeAt: new Date().toISOString(), ...details });
  fs.unlinkSync(processingFile);
}

export function requeueCrewExpenseReply(processingFile: string, errorMessage: string, maxAttempts = 5): boolean {
  const current = JSON.parse(fs.readFileSync(processingFile, "utf8")) as CrewExpenseReply;
  const attempts = Math.max(0, Number(current.attempts) || 0) + 1;
  if (attempts >= maxAttempts) {
    finishCrewExpenseReply(processingFile, "failed", { attempts, error: clean(errorMessage).slice(0, 500) });
    return false;
  }
  writeJsonAtomic(path.join(directory("outbox-incoming"), path.basename(processingFile)), {
    ...current, attempts, lastAttemptAt: new Date().toISOString(), lastError: clean(errorMessage).slice(0, 500),
  });
  fs.unlinkSync(processingFile);
  return true;
}

export function crewExpenseQueueCounts(): { records: number; pending: number; processing: number; failed: number; review: number; replies: number; replyFailures: number } {
  ensureDirectories();
  const count = (name: Parameters<typeof directory>[0]) => fs.readdirSync(directory(name)).filter((entry) => entry.endsWith(".json")).length;
  return {
    records: count("records"), pending: count("transactions-pending"), processing: count("transactions-processing"),
    failed: count("transactions-failed"), review: count("review"), replies: count("outbox-incoming"), replyFailures: count("outbox-failed"),
  };
}

export const crewExpenseTemplates = { dump: DUMP_TEMPLATE, fuel: FUEL_TEMPLATE } as const;
