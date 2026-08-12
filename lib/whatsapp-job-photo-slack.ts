import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { whatsappPhotoStateDirectory } from "@/lib/whatsapp-job-photo-queue";

type WhatsAppPhotoCategory = "before" | "after" | "donation";

export type WhatsAppPhotoSlackBatchPhoto = {
  messageId: string;
  category: WhatsAppPhotoCategory;
  receivedAt: string;
  status: "pending" | "completed";
  completedAt?: string;
};

export type WhatsAppPhotoSlackBatch = {
  version: 2;
  batchId: string;
  jkNumber: string;
  jobDate: string;
  openedAt: string;
  updatedAt: string;
  photos: WhatsAppPhotoSlackBatchPhoto[];
  attempts?: number;
  lastAttemptAt?: string;
  lastError?: string;
  nextAttemptAt?: string;
};

export type WhatsAppPhotoSlackDeliveryResult = {
  enabled: boolean;
  pending: number;
  attempted: number;
  delivered: number;
  failed: number;
};

type SlackApiResponse = {
  ok?: boolean;
  ts?: string;
  error?: string;
};

const DEFAULT_DISPATCH_CHANNEL_ID = "C0BNRMD25AS";
const DEFAULT_BATCH_QUIET_SECONDS = 60;

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function boolEnv(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(clean(process.env[name]));
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function whatsAppPhotoSlackNotificationsEnabled(): boolean {
  return boolEnv("SLACK_OPSCENTER_ALERTS_ENABLED")
    && boolEnv("SLACK_WHATSAPP_PHOTO_NOTIFICATIONS_ENABLED");
}

function batchDirectory(name: "pending" | "delivered"): string {
  return path.join(whatsappPhotoStateDirectory(), "slack-notifications", "batches", name);
}

function legacyDeliveredDirectory(): string {
  return path.join(whatsappPhotoStateDirectory(), "slack-notifications", "delivered");
}

function ensureDirectories(): void {
  for (const name of ["pending", "delivered"] as const) {
    fs.mkdirSync(batchDirectory(name), { recursive: true, mode: 0o700 });
  }
}

function recordKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function pendingBatchFile(jobDate: string, jkNumber: string): string {
  return path.join(batchDirectory("pending"), `${recordKey(`${jobDate}:${jkNumber}`)}.json`);
}

function deliveredBatchFile(batchId: string): string {
  return path.join(batchDirectory("delivered"), `${recordKey(batchId)}.json`);
}

function writeJsonAtomic(target: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function readBatch(file: string): WhatsAppPhotoSlackBatch | null {
  try {
    const batch = JSON.parse(fs.readFileSync(file, "utf8")) as WhatsAppPhotoSlackBatch;
    return batch?.version === 2 && Array.isArray(batch.photos) ? batch : null;
  } catch {
    return null;
  }
}

function jsonFiles(directory: string): string[] {
  try {
    return fs.readdirSync(directory)
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .sort()
      .map((name) => path.join(directory, name));
  } catch {
    return [];
  }
}

function messageWasDelivered(messageId: string): boolean {
  const legacyFile = path.join(legacyDeliveredDirectory(), `${recordKey(messageId)}.json`);
  if (fs.existsSync(legacyFile)) return true;
  return jsonFiles(batchDirectory("delivered")).some((file) =>
    readBatch(file)?.photos.some((photo) => photo.messageId === messageId),
  );
}

function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function opsCenterOrigin(): string {
  return clean(process.env.SLACK_OPSCENTER_BASE_URL || "https://ops.junk-king.app").replace(/\/$/, "");
}

function jobHref(batch: WhatsAppPhotoSlackBatch): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(batch.jobDate) ? batch.jobDate : "";
  const anchor = `job-${batch.jkNumber.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`;
  return `${opsCenterOrigin()}/jobs${date ? `?date=${encodeURIComponent(date)}` : ""}#${anchor}`;
}

function categorySummary(photos: WhatsAppPhotoSlackBatchPhoto[]): string {
  const counts = new Map<WhatsAppPhotoCategory, number>();
  for (const photo of photos) counts.set(photo.category, (counts.get(photo.category) || 0) + 1);
  const labels: Record<WhatsAppPhotoCategory, string> = {
    before: "before",
    after: "after",
    donation: "donation / receipt",
  };
  return (["before", "after", "donation"] as const)
    .flatMap((category) => counts.has(category) ? [`${counts.get(category)} ${labels[category]}`] : [])
    .join(" · ");
}

export function formatWhatsAppPhotoSlackNotification(batch: WhatsAppPhotoSlackBatch): string {
  const count = batch.photos.length;
  const noun = count === 1 ? "photo" : "photos";
  return [
    `:camera_with_flash: *OpsBot added ${count} ${noun} to <${jobHref(batch)}|${slackEscape(batch.jkNumber)}>*`,
    `*Photos:* ${categorySummary(batch.photos)}`,
    "All photos in this WhatsApp batch were verified in JunkWare.",
  ].join("\n");
}

export function recordWhatsAppPhotoSlackUpload(input: {
  messageId: string;
  jkNumber: string;
  category: WhatsAppPhotoCategory;
  receivedAt: string;
  jobDate: string;
  status: "pending" | "completed";
  now?: Date;
}): { duplicate: boolean } {
  ensureDirectories();
  const messageId = clean(input.messageId);
  const jkNumber = clean(input.jkNumber).toUpperCase();
  const jobDate = clean(input.jobDate);
  if (!messageId || !/^JK\d{4,12}$/.test(jkNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(jobDate)) {
    throw new Error("The WhatsApp Slack batch record is missing a valid message, JK number, or job date.");
  }
  if (messageWasDelivered(messageId)) return { duplicate: true };

  const now = input.now || new Date();
  const nowIso = now.toISOString();
  const file = pendingBatchFile(jobDate, jkNumber);
  const existing = readBatch(file);
  const batch: WhatsAppPhotoSlackBatch = existing || {
    version: 2,
    batchId: `${jobDate}:${jkNumber}:${messageId}`,
    jkNumber,
    jobDate,
    openedAt: nowIso,
    updatedAt: nowIso,
    photos: [],
  };
  const index = batch.photos.findIndex((photo) => photo.messageId === messageId);
  const current = index >= 0 ? batch.photos[index] : null;
  const nextPhoto: WhatsAppPhotoSlackBatchPhoto = {
    messageId,
    category: input.category,
    receivedAt: clean(input.receivedAt),
    status: input.status === "completed" || current?.status === "completed" ? "completed" : "pending",
    ...(input.status === "completed" || current?.status === "completed"
      ? { completedAt: current?.completedAt || nowIso }
      : {}),
  };
  if (index >= 0) batch.photos[index] = nextPhoto;
  else batch.photos.push(nextPhoto);
  batch.updatedAt = nowIso;
  delete batch.nextAttemptAt;
  writeJsonAtomic(file, batch);
  return { duplicate: Boolean(current && current.status === nextPhoto.status) };
}

function eligibleBatches(limit: number, now: Date): Array<{ file: string; batch: WhatsAppPhotoSlackBatch }> {
  const quietMs = numberEnv("SLACK_WHATSAPP_PHOTO_BATCH_QUIET_SECONDS", DEFAULT_BATCH_QUIET_SECONDS) * 1_000;
  return jsonFiles(batchDirectory("pending"))
    .flatMap((file) => {
      const batch = readBatch(file);
      if (!batch || !batch.photos.length || batch.photos.some((photo) => photo.status !== "completed")) return [];
      const updatedAt = new Date(batch.updatedAt).getTime();
      if (!Number.isFinite(updatedAt) || now.getTime() - updatedAt < quietMs) return [];
      const nextAttemptAt = new Date(clean(batch.nextAttemptAt)).getTime();
      if (Number.isFinite(nextAttemptAt) && nextAttemptAt > now.getTime()) return [];
      return [{ file, batch }];
    })
    .slice(0, Math.max(0, limit));
}

function clientMessageId(batchId: string): string {
  const digest = recordKey(batchId);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function retryDelaySeconds(attempts: number, retryAfterSeconds?: number): number {
  const exponential = Math.min(900, 30 * (2 ** Math.min(5, Math.max(0, attempts - 1))));
  return Math.max(exponential, retryAfterSeconds || 0);
}

export async function deliverWhatsAppPhotoSlackNotifications(options?: {
  fetchImpl?: typeof fetch;
  now?: Date;
  limit?: number;
}): Promise<WhatsAppPhotoSlackDeliveryResult> {
  const enabled = whatsAppPhotoSlackNotificationsEnabled();
  ensureDirectories();
  const allPending = jsonFiles(batchDirectory("pending")).length;
  const result: WhatsAppPhotoSlackDeliveryResult = {
    enabled,
    pending: allPending,
    attempted: 0,
    delivered: 0,
    failed: 0,
  };
  if (!enabled || !allPending) return result;

  const token = clean(process.env.SLACK_BOT_TOKEN);
  if (!token.startsWith("xoxb-")) return { ...result, failed: allPending };
  const channelId = clean(process.env.SLACK_WHATSAPP_PHOTO_CHANNEL_ID || process.env.SLACK_OPS_DISPATCH_CHANNEL_ID)
    || DEFAULT_DISPATCH_CHANNEL_ID;
  const fetchImpl = options?.fetchImpl || fetch;
  const now = options?.now || new Date();

  for (const { file, batch } of eligibleBatches(options?.limit ?? 10, now)) {
    result.attempted += 1;
    let responsePayload: SlackApiResponse = { ok: false, error: "Slack request failed" };
    let retryAfterSeconds = 0;
    try {
      const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          channel: channelId,
          text: formatWhatsAppPhotoSlackNotification(batch),
          mrkdwn: true,
          unfurl_links: false,
          unfurl_media: false,
          client_msg_id: clientMessageId(batch.batchId),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      retryAfterSeconds = Number(response.headers.get("retry-after")) || 0;
      responsePayload = await response.json().catch(() => ({ ok: false, error: `http_${response.status}` })) as SlackApiResponse;
      if (!response.ok && responsePayload.ok) responsePayload = { ok: false, error: `http_${response.status}` };
    } catch (error) {
      responsePayload = { ok: false, error: error instanceof Error ? error.message : "Slack request failed" };
    }

    if (responsePayload.ok && responsePayload.ts) {
      const delivered = deliveredBatchFile(batch.batchId);
      writeJsonAtomic(delivered, {
        ...batch,
        deliveredAt: now.toISOString(),
        slackChannelId: channelId,
        slackMessageTs: responsePayload.ts,
      });
      fs.unlinkSync(file);
      result.delivered += 1;
      result.pending -= 1;
      continue;
    }

    const attempts = Math.max(0, Number(batch.attempts) || 0) + 1;
    const nextAttemptAt = new Date(now.getTime() + retryDelaySeconds(attempts, retryAfterSeconds) * 1_000).toISOString();
    writeJsonAtomic(file, {
      ...batch,
      attempts,
      lastAttemptAt: now.toISOString(),
      lastError: clean(responsePayload.error || "Slack did not accept the notification").slice(0, 200),
      nextAttemptAt,
    });
    result.failed += 1;
  }
  return result;
}
