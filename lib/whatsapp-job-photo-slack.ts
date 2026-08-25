import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { slackEscape } from "@/lib/slack-message-format";
import { truckSlackChannelId } from "@/lib/slack-truck-channels";
import { whatsappPhotoStateDirectory } from "@/lib/whatsapp-job-photo-queue";

type WhatsAppPhotoCategory = "before" | "after" | "donation";

export type WhatsAppPhotoSlackBatchPhoto = {
  messageId: string;
  category: WhatsAppPhotoCategory;
  receivedAt: string;
  status: "pending" | "completed";
  completedAt?: string;
  mediaFile?: string;
};

type SlackStagedFile = {
  messageId: string;
  fileId: string;
  title: string;
};

export type WhatsAppPhotoSlackBatch = {
  version: 2;
  batchId: string;
  jkNumber: string;
  jobDate: string;
  truck?: string;
  openedAt: string;
  updatedAt: string;
  photos: WhatsAppPhotoSlackBatchPhoto[];
  slackStagedFiles?: SlackStagedFile[];
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
  upload_url?: string;
  file_id?: string;
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

function mediaDirectory(): string {
  return path.join(whatsappPhotoStateDirectory(), "media");
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

function opsCenterOrigin(): string {
  return clean(process.env.SLACK_OPSCENTER_BASE_URL || "https://ops.junk-king.app").replace(/\/$/, "");
}

function jobHref(batch: WhatsAppPhotoSlackBatch): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(batch.jobDate) ? batch.jobDate : "";
  const anchor = `job-${batch.jkNumber.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`;
  return `${opsCenterOrigin()}/jobs${date ? `?date=${encodeURIComponent(date)}` : ""}#${anchor}`;
}

export function formatWhatsAppPhotoSlackNotification(batch: WhatsAppPhotoSlackBatch): string {
  const count = batch.photos.length;
  const noun = count === 1 ? "photo" : "photos";
  return [
    ":camera_with_flash: *Photos Uploaded*",
    `*<${jobHref(batch)}|${slackEscape(batch.jkNumber)}>*`,
    `${count} ${noun}`,
    "Verified",
  ].join("\n");
}

export function recordWhatsAppPhotoSlackUpload(input: {
  messageId: string;
  jkNumber: string;
  category: WhatsAppPhotoCategory;
  receivedAt: string;
  jobDate: string;
  truck?: string;
  status: "pending" | "completed";
  filePath?: string;
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
    ...(clean(input.truck) ? { truck: clean(input.truck) } : {}),
    openedAt: nowIso,
    updatedAt: nowIso,
    photos: [],
  };
  if (!batch.truck && clean(input.truck)) batch.truck = clean(input.truck);
  const index = batch.photos.findIndex((photo) => photo.messageId === messageId);
  const current = index >= 0 ? batch.photos[index] : null;
  let mediaFile = current?.mediaFile;
  if (input.status === "completed") {
    const resolvedFile = path.resolve(clean(input.filePath));
    const resolvedMediaDirectory = path.resolve(mediaDirectory());
    if (path.dirname(resolvedFile) !== resolvedMediaDirectory || !/^[a-f0-9]{64}\.(?:jpg|png)$/.test(path.basename(resolvedFile))) {
      throw new Error("The completed WhatsApp photo is outside the protected media directory.");
    }
    mediaFile = path.basename(resolvedFile);
  }
  const nextPhoto: WhatsAppPhotoSlackBatchPhoto = {
    messageId,
    category: input.category,
    receivedAt: clean(input.receivedAt),
    status: input.status === "completed" || current?.status === "completed" ? "completed" : "pending",
    ...(input.status === "completed" || current?.status === "completed"
      ? { completedAt: current?.completedAt || nowIso }
      : {}),
    ...(mediaFile ? { mediaFile } : {}),
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
      if (!batch || !batch.photos.length || batch.photos.some((photo) => photo.status !== "completed" || !photo.mediaFile)) return [];
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

async function slackApiRequest(
  token: string,
  method: string,
  body: URLSearchParams | Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<{ payload: SlackApiResponse; retryAfterSeconds: number }> {
  try {
    const formEncoded = body instanceof URLSearchParams;
    const response = await fetchImpl(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": formEncoded
          ? "application/x-www-form-urlencoded; charset=utf-8"
          : "application/json; charset=utf-8",
      },
      body: formEncoded ? body.toString() : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({ ok: false, error: `http_${response.status}` })) as SlackApiResponse;
    if (!response.ok && payload.ok) return {
      payload: { ok: false, error: `http_${response.status}` },
      retryAfterSeconds: Number(response.headers.get("retry-after")) || 0,
    };
    return { payload, retryAfterSeconds: Number(response.headers.get("retry-after")) || 0 };
  } catch (error) {
    return {
      payload: { ok: false, error: error instanceof Error ? error.message : "Slack request failed" },
      retryAfterSeconds: 0,
    };
  }
}

function photoTitle(batch: WhatsAppPhotoSlackBatch, photo: WhatsAppPhotoSlackBatchPhoto, index: number): string {
  const label = photo.category === "before" ? "before" : photo.category === "donation" ? "donation-receipt" : "after";
  return `${batch.jkNumber}-${label}-${index + 1}`;
}

async function uploadSlackBatch(
  token: string,
  channelId: string,
  file: string,
  batch: WhatsAppPhotoSlackBatch,
  fetchImpl: typeof fetch,
): Promise<{ payload: SlackApiResponse; retryAfterSeconds: number }> {
  const staged = new Map((batch.slackStagedFiles || []).map((entry) => [entry.messageId, entry]));
  let retryAfterSeconds = 0;
  for (const [index, photo] of batch.photos.entries()) {
    if (staged.has(photo.messageId)) continue;
    const filePath = path.join(mediaDirectory(), clean(photo.mediaFile));
    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
    } catch {
      return { payload: { ok: false, error: "WhatsApp photo file is unavailable" }, retryAfterSeconds };
    }
    if (!stats.isFile() || !stats.size || stats.size > 5 * 1024 * 1024) {
      return { payload: { ok: false, error: "WhatsApp photo file is invalid" }, retryAfterSeconds };
    }
    const title = photoTitle(batch, photo, index);
    const extension = path.extname(filePath).toLowerCase();
    const ticket = await slackApiRequest(token, "files.getUploadURLExternal", new URLSearchParams({
      filename: `${title}${extension}`,
      length: String(stats.size),
      alt_txt: `${title} job photo`,
    }), fetchImpl);
    retryAfterSeconds = Math.max(retryAfterSeconds, ticket.retryAfterSeconds);
    const uploadUrl = clean(ticket.payload.upload_url);
    const fileId = clean(ticket.payload.file_id);
    if (!ticket.payload.ok || !uploadUrl || !fileId) return { payload: ticket.payload, retryAfterSeconds };
    try {
      const uploadResponse = await fetchImpl(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": extension === ".png" ? "image/png" : "image/jpeg" },
        body: fs.readFileSync(filePath),
        signal: AbortSignal.timeout(30_000),
      });
      retryAfterSeconds = Math.max(retryAfterSeconds, Number(uploadResponse.headers.get("retry-after")) || 0);
      if (!uploadResponse.ok) return {
        payload: { ok: false, error: `file_upload_http_${uploadResponse.status}` },
        retryAfterSeconds,
      };
    } catch (error) {
      return {
        payload: { ok: false, error: error instanceof Error ? error.message : "Slack file upload failed" },
        retryAfterSeconds,
      };
    }
    staged.set(photo.messageId, { messageId: photo.messageId, fileId, title });
    batch.slackStagedFiles = [...staged.values()];
    writeJsonAtomic(file, batch);
  }

  const completion = await slackApiRequest(token, "files.completeUploadExternal", {
    files: batch.photos.map((photo) => {
      const entry = staged.get(photo.messageId);
      return { id: entry?.fileId, title: entry?.title };
    }),
    channel_id: channelId,
    initial_comment: formatWhatsAppPhotoSlackNotification(batch),
  }, fetchImpl);
  return {
    payload: completion.payload,
    retryAfterSeconds: Math.max(retryAfterSeconds, completion.retryAfterSeconds),
  };
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
  const fallbackChannelId = clean(process.env.SLACK_WHATSAPP_PHOTO_CHANNEL_ID || process.env.SLACK_OPS_DISPATCH_CHANNEL_ID)
    || DEFAULT_DISPATCH_CHANNEL_ID;
  const fetchImpl = options?.fetchImpl || fetch;
  const now = options?.now || new Date();
  const attachmentsEnabled = boolEnv("SLACK_WHATSAPP_PHOTO_ATTACHMENTS_ENABLED");

  for (const { file, batch } of eligibleBatches(options?.limit ?? 10, now)) {
    const channelId = truckSlackChannelId(batch.truck, fallbackChannelId);
    result.attempted += 1;
    let responsePayload: SlackApiResponse = { ok: false, error: "Slack request failed" };
    let retryAfterSeconds = 0;
    if (attachmentsEnabled) {
      const upload = await uploadSlackBatch(token, channelId, file, batch, fetchImpl);
      responsePayload = upload.payload;
      retryAfterSeconds = upload.retryAfterSeconds;
    } else {
      const message = await slackApiRequest(token, "chat.postMessage", {
        channel: channelId,
        text: formatWhatsAppPhotoSlackNotification(batch),
        mrkdwn: true,
        unfurl_links: false,
        unfurl_media: false,
        client_msg_id: clientMessageId(batch.batchId),
      }, fetchImpl);
      responsePayload = message.payload;
      retryAfterSeconds = message.retryAfterSeconds;
    }

    if (responsePayload.ok && (attachmentsEnabled || responsePayload.ts)) {
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
