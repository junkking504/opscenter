import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chicagoDateKey } from "@/lib/chicago-date";
import { normalizePhone } from "@/lib/whatsapp-job-photo-matching";

export type WhatsAppImageMessage = {
  version: 1;
  messageId: string;
  senderPhone: string;
  receivedAt: string;
  phoneNumberId: string;
  mediaId: string;
  mimeType: string;
  sha256: string;
  caption: string;
  enqueuedAt: string;
  matchingContext?: { version: 1; text: string; sourceMessageIds: string[]; capturedAt: string; reviewReason?: "ambiguous_context" };
};

export type WhatsAppTextMessage = {
  messageId: string;
  senderPhone: string;
  receivedAt: string;
  phoneNumberId: string;
  text: string;
};

export type WhatsAppInboundMessage = {
  messageId: string;
  senderPhone: string;
  receivedAt: string;
  phoneNumberId: string;
  type: string;
};

type MetaMessage = {
  id?: unknown;
  from?: unknown;
  timestamp?: unknown;
  type?: unknown;
  text?: { body?: unknown };
  image?: { id?: unknown; mime_type?: unknown; sha256?: unknown; caption?: unknown };
};

const QUEUE_DIRECTORIES = ["incoming", "processing", "completed", "review", "failed"] as const;

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeTimestamp(value: unknown): string {
  const seconds = Number(value);
  const parsed = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1_000) : new Date();
  return parsed.toISOString();
}

export function whatsappPhotoStateDirectory(): string {
  const configured = clean(process.env.WHATSAPP_JOB_PHOTO_STATE_DIR);
  return configured || path.join(process.cwd(), "data", "integrations", "whatsapp-job-photos");
}

function directory(name: typeof QUEUE_DIRECTORIES[number] | "context" | "media"): string {
  return path.join(whatsappPhotoStateDirectory(), name);
}

function ensureDirectories(): void {
  for (const name of [...QUEUE_DIRECTORIES, "context", "media"] as const) {
    fs.mkdirSync(directory(name), { recursive: true, mode: 0o700 });
  }
}

function recordKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function queueFile(queue: typeof QUEUE_DIRECTORIES[number], messageId: string): string {
  return path.join(directory(queue), `${recordKey(messageId)}.json`);
}

function writeJsonAtomic(target: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function parseImage(message: MetaMessage, phoneNumberId: string): WhatsAppImageMessage | null {
  if (clean(message.type) !== "image") return null;
  const messageId = clean(message.id);
  const senderPhone = normalizePhone(message.from);
  const mediaId = clean(message.image?.id);
  if (!messageId || !senderPhone || !mediaId) return null;
  return {
    version: 1,
    messageId,
    senderPhone,
    receivedAt: safeTimestamp(message.timestamp),
    phoneNumberId,
    mediaId,
    mimeType: clean(message.image?.mime_type),
    sha256: clean(message.image?.sha256),
    caption: clean(message.image?.caption).slice(0, 2_000),
    enqueuedAt: new Date().toISOString(),
  };
}

function parseText(message: MetaMessage, phoneNumberId: string): WhatsAppTextMessage | null {
  if (clean(message.type) !== "text") return null;
  const messageId = clean(message.id);
  const senderPhone = normalizePhone(message.from);
  const text = clean(message.text?.body).slice(0, 2_000);
  if (!messageId || !senderPhone || !text) return null;
  return { messageId, senderPhone, receivedAt: safeTimestamp(message.timestamp), phoneNumberId, text };
}

export function parseWhatsAppWebhook(payload: unknown): {
  messages: WhatsAppInboundMessage[];
  images: WhatsAppImageMessage[];
  texts: WhatsAppTextMessage[];
  phoneNumberIds: string[];
} {
  const inboundMessages: WhatsAppInboundMessage[] = [];
  const images: WhatsAppImageMessage[] = [];
  const texts: WhatsAppTextMessage[] = [];
  const phoneNumberIds = new Set<string>();
  if (!payload || typeof payload !== "object") return { messages: inboundMessages, images, texts, phoneNumberIds: [] };
  const entries = Array.isArray((payload as { entry?: unknown }).entry) ? (payload as { entry: unknown[] }).entry : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const changes = Array.isArray((entry as { changes?: unknown }).changes) ? (entry as { changes: unknown[] }).changes : [];
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const value = (change as { value?: unknown }).value;
      if (!value || typeof value !== "object") continue;
      const phoneNumberId = clean((value as { metadata?: { phone_number_id?: unknown } }).metadata?.phone_number_id);
      if (phoneNumberId) phoneNumberIds.add(phoneNumberId);
      const messages = Array.isArray((value as { messages?: unknown }).messages) ? (value as { messages: MetaMessage[] }).messages : [];
      for (const message of messages) {
        const messageId = clean(message.id);
        const senderPhone = normalizePhone(message.from);
        const type = clean(message.type);
        if (messageId && senderPhone && type) {
          inboundMessages.push({
            messageId,
            senderPhone,
            receivedAt: safeTimestamp(message.timestamp),
            phoneNumberId,
            type,
          });
        }
        const image = parseImage(message, phoneNumberId);
        if (image) images.push(image);
        const text = parseText(message, phoneNumberId);
        if (text) texts.push(text);
      }
    }
  }
  return { messages: inboundMessages, images, texts, phoneNumberIds: [...phoneNumberIds] };
}

export function verifyMetaSignature(rawBody: string, signatureHeader: string, appSecret: string): boolean {
  const signature = clean(signatureHeader);
  const secret = String(appSecret || "");
  if (!signature.startsWith("sha256=") || !secret) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function recordWhatsAppTextContext(message: WhatsAppTextMessage): void {
  ensureDirectories();
  const at = Date.parse(message.receivedAt);
  if (!Number.isFinite(at) || !message.messageId || !message.phoneNumberId) return;
  const history = path.join(whatsappPhotoStateDirectory(), 'context-history', recordKey(normalizePhone(message.senderPhone)), recordKey(message.phoneNumberId));
  fs.mkdirSync(history, { recursive: true, mode: 0o700 });
  const entry = path.join(history, `${String(at).padStart(13, '0')}-${recordKey(message.messageId)}.json`);
  try { fs.writeFileSync(entry, JSON.stringify({ version: 1, ...message }), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return; }
  const target = path.join(directory("context"), `${recordKey(normalizePhone(message.senderPhone))}.json`);
  try { if (Date.parse(JSON.parse(fs.readFileSync(target, 'utf8')).receivedAt) > at) return; } catch { /* First context. */ }
  writeJsonAtomic(target, { version: 1, ...message });
}

export function recentWhatsAppPhotoContext(senderPhone: string, receivedAt: Date, maxAgeMinutes = 10, phoneNumberId?: string, excludedMessageId?: string): { text: string; sourceMessageIds: string[]; reviewReason?: "ambiguous_context" } {
  const photoAt = receivedAt.getTime(), minimum = photoAt - maxAgeMinutes * 60_000;
  if (!Number.isFinite(photoAt) || !Number.isFinite(minimum)) return { text: '', sourceMessageIds: [] };
  const candidates = new Map<string, WhatsAppTextMessage>();
  const accept = (payload: WhatsAppTextMessage) => {
    const at = Date.parse(payload.receivedAt);
    if (!payload.messageId || payload.messageId === excludedMessageId || normalizePhone(payload.senderPhone) !== normalizePhone(senderPhone)
      || phoneNumberId && payload.phoneNumberId !== phoneNumberId || !Number.isFinite(at) || at > photoAt || at < minimum) return;
    if (!candidates.has(payload.messageId)) candidates.set(payload.messageId, payload);
  };
  const parent = path.join(whatsappPhotoStateDirectory(), 'context-history', recordKey(normalizePhone(senderPhone)));
  let inboxes: string[] = [];
  try { inboxes = phoneNumberId ? [recordKey(phoneNumberId)] : fs.readdirSync(parent).filter(name => /^[a-f0-9]{64}$/.test(name)); } catch { /* Legacy context only. */ }
  for (const inbox of inboxes) {
    let files: string[] = [];
    try { files = fs.readdirSync(path.join(parent, inbox)).filter(name => /^\d{13}-[a-f0-9]{64}\.json$/.test(name) && Number(name.slice(0, 13)) >= minimum && Number(name.slice(0, 13)) <= photoAt).sort().reverse(); } catch { continue; }
    // Fail closed on an unexpectedly dense context window rather than picking
    // an arbitrary job from a truncated history.
    if (files.length > 200) return { text: '', sourceMessageIds: [], reviewReason: 'ambiguous_context' };
    for (const file of files) {
      try { const p = path.join(parent, inbox, file); const stat = fs.lstatSync(p); if (stat.isFile() && stat.size <= 20_000) accept(JSON.parse(fs.readFileSync(p, 'utf8'))); } catch { /* A partial write is not usable context. */ }
    }
  }
  const target = path.join(directory("context"), `${recordKey(normalizePhone(senderPhone))}.json`);
  try { accept(JSON.parse(fs.readFileSync(target, 'utf8'))); } catch { /* No legacy context. */ }
  const rows = [...candidates.values()].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  if (!phoneNumberId && new Set(rows.map(row => row.phoneNumberId)).size > 1) return { text: '', sourceMessageIds: [], reviewReason: 'ambiguous_context' };
  const modifier = (row: WhatsAppTextMessage) => /^(?:before|after|donation(?: receipt)?|(?:add|upload|job)?\s*photos?)\s*[.!]?$/i.test(clean(row.text));
  const selected: WhatsAppTextMessage[] = [];
  for (let index = 0; index < rows.length;) {
    const at = Date.parse(rows[index].receivedAt);
    const group: WhatsAppTextMessage[] = [];
    while (index < rows.length && Date.parse(rows[index].receivedAt) === at) group.push(rows[index++]);
    // Meta timestamps have second precision. Conflicting messages within that
    // second have no reliable ordering, so never choose by filename/hash.
    const identities = group.filter(row => !modifier(row));
    const modifiers = group.filter(modifier);
    if (new Set(identities.map(row => clean(row.text).toLowerCase())).size > 1
      || new Set(modifiers.map(row => clean(row.text).toLowerCase())).size > 1) return { text: '', sourceMessageIds: [], reviewReason: 'ambiguous_context' };
    selected.push(...modifiers, ...identities);
    if (identities.length) break;
    if (selected.length >= 20) return { text: '', sourceMessageIds: [], reviewReason: 'ambiguous_context' };
  }
  /* Context is ordered newest first; category modifiers retain their JK. */
  return { text: [selected.find(modifier), ...selected.filter(row => !modifier(row))].filter((row): row is WhatsAppTextMessage => Boolean(row)).map(row => clean(row.text)).join(' ').slice(0, 2_000), sourceMessageIds: selected.map(row => row.messageId) };
}

export function recentWhatsAppText(senderPhone: string, receivedAt: Date, maxAgeMinutes = 10, phoneNumberId?: string, excludedMessageId?: string): string {
  return recentWhatsAppPhotoContext(senderPhone, receivedAt, maxAgeMinutes, phoneNumberId, excludedMessageId).text;
}

export function enqueueWhatsAppImage(message: WhatsAppImageMessage): { duplicate: boolean } {
  ensureDirectories();
  for (const queue of QUEUE_DIRECTORIES) {
    if (fs.existsSync(queueFile(queue, message.messageId))) return { duplicate: true };
  }
  const target = queueFile("incoming", message.messageId);
  const configuredAge = Number(process.env.WHATSAPP_CONTEXT_MAX_AGE_MINUTES ?? 10);
  const context = recentWhatsAppPhotoContext(message.senderPhone, new Date(message.receivedAt), Number.isFinite(configuredAge) && configuredAge >= 0 ? configuredAge : 10, message.phoneNumberId, message.messageId);
  const bound = { ...message, matchingContext: { version: 1 as const, ...context, capturedAt: new Date().toISOString() } };
  try {
    fs.writeFileSync(target, `${JSON.stringify(bound, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return { duplicate: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { duplicate: true };
    throw error;
  }
}

export function queuedWhatsAppImages(limit = 10): string[] {
  ensureDirectories();
  return fs.readdirSync(directory("incoming"))
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .sort()
    .slice(0, Math.max(0, limit))
    .map((name) => path.join(directory("incoming"), name));
}

export function hasUnfinishedWhatsAppPhotosForSender(batch: {
  senderPhone: string;
  phoneNumberId: string;
  jobDate: string;
}): boolean {
  ensureDirectories();
  for (const queue of ["incoming", "processing"] as const) {
    for (const name of fs.readdirSync(directory(queue))) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      let message: WhatsAppImageMessage;
      try {
        message = JSON.parse(fs.readFileSync(path.join(directory(queue), name), "utf8"));
      } catch (error) {
        // A worker may finish or claim a record between listing and reading it.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (normalizePhone(message.senderPhone) !== normalizePhone(batch.senderPhone)) continue;
      if (message.phoneNumberId !== batch.phoneNumberId) continue;
      const receivedAt = new Date(message.receivedAt);
      // Captionless images may be part of this batch. Keep the whole sender/day
      // pending, without letting another sender or an old day's orphan block it.
      if (!Number.isFinite(receivedAt.getTime()) || chicagoDateKey(receivedAt) === batch.jobDate) return true;
    }
  }
  return false;
}

export function claimWhatsAppImage(incomingFile: string): { file: string; message: WhatsAppImageMessage } | null {
  ensureDirectories();
  const base = path.basename(incomingFile);
  if (!/^[a-f0-9]{64}\.json$/.test(base)) return null;
  const processingFile = path.join(directory("processing"), base);
  try {
    fs.renameSync(incomingFile, processingFile);
    const message = JSON.parse(fs.readFileSync(processingFile, "utf8")) as WhatsAppImageMessage;
    return { file: processingFile, message };
  } catch {
    return null;
  }
}

export function finishWhatsAppImage(
  processingFile: string,
  outcome: "completed" | "review" | "failed",
  details: Record<string, unknown>,
): string {
  const current = JSON.parse(fs.readFileSync(processingFile, "utf8"));
  const target = path.join(directory(outcome), path.basename(processingFile));
  writeJsonAtomic(target, { ...current, outcome, outcomeAt: new Date().toISOString(), ...details });
  fs.unlinkSync(processingFile);
  return target;
}

export function requeueWhatsAppImage(processingFile: string, errorMessage: string, maxAttempts = 3): boolean {
  const current = JSON.parse(fs.readFileSync(processingFile, "utf8"));
  const attempts = Math.max(0, Number(current.attempts) || 0) + 1;
  if (attempts >= maxAttempts) {
    finishWhatsAppImage(processingFile, "failed", {
      attempts,
      error: clean(errorMessage).slice(0, 500),
    });
    return false;
  }
  const target = path.join(directory("incoming"), path.basename(processingFile));
  writeJsonAtomic(target, {
    ...current,
    attempts,
    lastAttemptAt: new Date().toISOString(),
    lastError: clean(errorMessage).slice(0, 500),
  });
  fs.unlinkSync(processingFile);
  return true;
}

export function whatsappMediaFile(messageId: string, mimeType: string): string {
  ensureDirectories();
  const extension = mimeType === "image/png" ? "png" : "jpg";
  return path.join(directory("media"), `${recordKey(messageId)}.${extension}`);
}

export function whatsappQueueCounts(): Record<typeof QUEUE_DIRECTORIES[number], number> {
  ensureDirectories();
  return Object.fromEntries(QUEUE_DIRECTORIES.map((name) => [
    name,
    fs.readdirSync(directory(name)).filter((entry) => entry.endsWith(".json")).length,
  ])) as Record<typeof QUEUE_DIRECTORIES[number], number>;
}
