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

type CrewExpenseFields = Partial<Record<"truck" | "location" | "cost" | "weight" | "gallons" | "time", string>>;

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
  "1035",
].join("\n");

const FUEL_TEMPLATE = [
  "Truck 1",
  "Shell",
  "24 gallons",
  "$100",
  "212",
].join("\n");

const SESSION_MAX_IDLE_MS = 12 * 60 * 60 * 1_000;

function clean(value: unknown): string {
  return String(value || "").replace(/[ \t]+/g, " ").trim();
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

function chicagoMinutes(receivedAt: string): number | null {
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
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

function closestMeridiemHour(hour: number, minute: number, receivedAt: string): number {
  if (hour === 12) return 12;
  const reference = chicagoMinutes(receivedAt);
  if (reference === null) return hour;
  const candidates = [hour, hour + 12];
  return candidates.reduce((closest, candidate) => {
    const candidateMinutes = candidate * 60 + minute;
    const distance = Math.min(
      Math.abs(candidateMinutes - reference),
      Math.abs(candidateMinutes + 24 * 60 - reference),
      Math.abs(candidateMinutes - 24 * 60 - reference),
    );
    const closestMinutes = closest * 60 + minute;
    const closestDistance = Math.min(
      Math.abs(closestMinutes - reference),
      Math.abs(closestMinutes + 24 * 60 - reference),
      Math.abs(closestMinutes - 24 * 60 - reference),
    );
    return distance < closestDistance ? candidate : closest;
  });
}

function parseTime(value: string, receivedAt: string): string | null {
  const normalized = clean(value).toUpperCase().replace(/\./g, "").replace(/[!,;]+$/, "").replace(/\s+/g, " ");
  const twelveHour = normalized.match(/^(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([AP]M)$/);
  if (twelveHour) return `${Number(twelveHour[1])}:${twelveHour[2] || "00"} ${twelveHour[3]}`;
  const compactMeridiem = normalized.match(/^(\d{3,4})\s*([AP]M)$/);
  if (compactMeridiem) {
    const digits = compactMeridiem[1];
    const hour = Number(digits.slice(0, -2));
    const minute = Number(digits.slice(-2));
    if (hour < 1 || hour > 12 || minute > 59) return null;
    const twentyFourHour = compactMeridiem[2] === "PM" && hour !== 12 ? hour + 12 : compactMeridiem[2] === "AM" && hour === 12 ? 0 : hour;
    return formatTime(twentyFourHour, minute);
  }
  const twentyFourHour = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (twentyFourHour) return formatTime(Number(twentyFourHour[1]), Number(twentyFourHour[2]));
  const compact = normalized.match(/^(\d{3,4})$/);
  if (!compact) return null;
  const digits = compact[1];
  const hour = Number(digits.slice(0, -2));
  const minute = Number(digits.slice(-2));
  if (minute > 59) return null;
  if (digits.length === 4) return hour <= 23 ? formatTime(hour, minute) : null;
  if (hour < 1 || hour > 12) return null;
  return formatTime(closestMeridiemHour(hour, minute, receivedAt), minute);
}

function commandKind(text: string): CrewExpenseKind | null {
  const command = clean(text).toLowerCase();
  if (/^dump(?:\s+(?:run|expense))?$/.test(command)) return "dump";
  if (/^(?:fuel|gas)(?:\s+(?:fill-?up|expense))?$/.test(command)) return "fuel";
  return null;
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
    const match = line.match(/^(truck\s*#?|location|cost|weight|gallons?|time)\s*:\s*(.*)$/i);
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

function freeformKind(text: string): CrewExpenseKind | null {
  if (/\bdump\b/i.test(text)) return "dump";
  if (/\b\d+(?:\.\d{1,3})?\s*(?:g|gal(?:lon)?s?)\.?\b/i.test(text)) return "fuel";
  if (/\bgal(?:lon)?s?\s*[:#-]?\s*\d+(?:\.\d{1,3})?\b/i.test(text)) return "fuel";
  if (/\b(?:fuel|gas)\b/i.test(text)) return "fuel";
  if (/\b\d+(?:\.\d+)?\s*(?:tons?|lbs?|pounds?|kg|kgs|kilograms?)\.?\b/i.test(text)) return "dump";
  if (/\b(?:tons?|lbs?|pounds?|kg|kgs|kilograms?)\s*[:#-]?\s*\d+(?:\.\d+)?\b/i.test(text)) return "dump";
  return null;
}

function freeformFields(
  lines: string[],
  kind: CrewExpenseKind,
  existing: CrewExpenseFields,
  receivedAt: string,
): CrewExpenseFields {
  const fields: CrewExpenseFields = {};
  for (const rawLine of lines) {
    const line = clean(rawLine);
    if (!line || /^(?:fuel|gas|dump)$/i.test(line)) continue;
    let remainder = line;
    let extractedStrongField = false;
    const take = (key: keyof CrewExpenseFields, pattern: RegExp): void => {
      if (existing[key] || fields[key]) return;
      const match = remainder.match(pattern);
      if (!match) return;
      fields[key] = clean(match[0]);
      remainder = clean(`${remainder.slice(0, match.index)} ${remainder.slice((match.index || 0) + match[0].length)}`);
      extractedStrongField = true;
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

    if (!existing.time && !fields.time) {
      const explicitTime = remainder.match(/\b(?:\d{1,2}:\d{2}|\d{1,4})\s*[ap]\.?m\.?\b/i)?.[0]
        || remainder.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/)?.[0]
        || "";
      const compactTime = [...remainder.matchAll(/\b\d{3,4}\b/g)]
        .map((match) => match[0])
        .find((candidate) => parseTime(candidate, receivedAt)) || "";
      const timeCandidate = explicitTime || compactTime;
      if (timeCandidate && (remainder === timeCandidate || extractedStrongField) && parseTime(timeCandidate, receivedAt)) {
        fields.time = timeCandidate;
        remainder = clean(remainder.replace(timeCandidate, " "));
      } else if (parseTime(remainder, receivedAt)) {
        fields.time = remainder;
        remainder = "";
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
    ? "Weight is optional. Send each value without labels; compact times such as 1035 work."
    : "Gallons is required. Send each value without labels; compact times such as 1412 or 212 work.";
  return `${problems} ${guidance}\n\n${kind === "dump" ? DUMP_TEMPLATE : FUEL_TEMPLATE}`.trim();
}

export function ingestCrewExpenseText(message: WhatsAppTextMessage): CrewExpenseIngestResult {
  ensureDirectories();
  const marker = messageFile(message.messageId);
  if (fs.existsSync(marker)) return { status: "duplicate" };

  const command = commandKind(message.text);
  if (command) {
    openSession(message, command);
    enqueueReply(message, `Send each item separately or all at once — no labels needed:\n\n${command === "dump" ? DUMP_TEMPLATE : FUEL_TEMPLATE}${command === "dump" ? "\n\nWeight is optional." : ""}`, "expense-prompt");
    writeJsonAtomic(marker, { version: 1, messageId: message.messageId, outcome: "prompted", kind: command, processedAt: new Date().toISOString() });
    return { status: "prompted", kind: command };
  }

  const parsed = fieldsFromMessage(message.text);
  const heading = messageHeading(parsed.lines);
  const inferred = parsed.fields.gallons ? "fuel" : parsed.fields.weight ? "dump" : freeformKind(message.text);
  const session = activeSession(message.senderPhone, message.receivedAt);
  const kind = heading || session?.kind || inferred;
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
  const inferredFields = freeformFields(parsed.lines, kind, { ...previousFields, ...parsed.fields }, message.receivedAt);
  const fields = { ...previousFields, ...parsed.fields, ...inferredFields };
  const currentSession = session?.kind === kind
    ? updateSession(message, session, fields)
    : null;

  const required = kind === "dump" ? ["truck", "location", "cost", "time"] : ["truck", "location", "cost", "gallons", "time"];
  const missing = required.filter((key) => !fields[key as keyof CrewExpenseFields]);
  const truck = fields.truck ? normalizeTruck(fields.truck) : null;
  const cost = fields.cost ? parseMoney(fields.cost) : null;
  const gallons = kind === "fuel" && fields.gallons ? parseGallons(fields.gallons) : null;
  const time = fields.time ? parseTime(fields.time, message.receivedAt) : null;
  const invalid = [
    ...(fields.truck && !truck ? ["Truck"] : []),
    ...(fields.location && (fields.location.length < 2 || fields.location.length > 120) ? ["Location"] : []),
    ...(fields.cost && cost === null ? ["Cost"] : []),
    ...(kind === "fuel" && fields.gallons && gallons === null ? ["Gallons"] : []),
    ...(fields.time && !time ? ["Time"] : []),
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
    location: fields.location || "",
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
  }, `${transaction.record.kind === "dump" ? "Dump" : "Fuel"} verified in JunkWare — ${transaction.record.truck} · ${transaction.record.location} · $${transaction.record.cost.toFixed(2)}${detail} · ${transaction.record.time}`, "expense-verified");
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
