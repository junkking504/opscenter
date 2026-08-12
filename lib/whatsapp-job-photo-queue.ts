import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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
  const target = path.join(directory("context"), `${recordKey(normalizePhone(message.senderPhone))}.json`);
  writeJsonAtomic(target, { version: 1, ...message });
}

export function recentWhatsAppText(senderPhone: string, receivedAt: Date, maxAgeMinutes = 10): string {
  const target = path.join(directory("context"), `${recordKey(normalizePhone(senderPhone))}.json`);
  try {
    const payload = JSON.parse(fs.readFileSync(target, "utf8"));
    const contextAt = new Date(String(payload.receivedAt || "")).getTime();
    const photoAt = receivedAt.getTime();
    if (!Number.isFinite(contextAt) || contextAt > photoAt + 60_000 || photoAt - contextAt > maxAgeMinutes * 60_000) return "";
    return clean(payload.text).slice(0, 2_000);
  } catch {
    return "";
  }
}

export function enqueueWhatsAppImage(message: WhatsAppImageMessage): { duplicate: boolean } {
  ensureDirectories();
  for (const queue of QUEUE_DIRECTORIES) {
    if (fs.existsSync(queueFile(queue, message.messageId))) return { duplicate: true };
  }
  const target = queueFile("incoming", message.messageId);
  try {
    fs.writeFileSync(target, `${JSON.stringify(message, null, 2)}\n`, { flag: "wx", mode: 0o600 });
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
