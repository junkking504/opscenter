import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { whatsappPhotoStateDirectory } from "@/lib/whatsapp-job-photo-queue";

export type WhatsAppPhotoSlackNotification = {
  version: 1;
  messageId: string;
  jkNumber: string;
  category: "before" | "after" | "donation";
  receivedAt: string;
  jobDate: string;
  queuedAt: string;
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

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function boolEnv(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(clean(process.env[name]));
}

export function whatsAppPhotoSlackNotificationsEnabled(): boolean {
  return boolEnv("SLACK_OPSCENTER_ALERTS_ENABLED")
    && boolEnv("SLACK_WHATSAPP_PHOTO_NOTIFICATIONS_ENABLED");
}

function notificationDirectory(name: "pending" | "delivered"): string {
  return path.join(whatsappPhotoStateDirectory(), "slack-notifications", name);
}

function ensureDirectories(): void {
  for (const name of ["pending", "delivered"] as const) {
    fs.mkdirSync(notificationDirectory(name), { recursive: true, mode: 0o700 });
  }
}

function recordKey(messageId: string): string {
  return crypto.createHash("sha256").update(messageId).digest("hex");
}

function notificationFile(directory: "pending" | "delivered", messageId: string): string {
  return path.join(notificationDirectory(directory), `${recordKey(messageId)}.json`);
}

function writeJsonAtomic(target: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function opsCenterOrigin(): string {
  return clean(process.env.SLACK_OPSCENTER_BASE_URL || "https://ops.junk-king.app").replace(/\/$/, "");
}

function jobHref(notification: WhatsAppPhotoSlackNotification): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(notification.jobDate) ? notification.jobDate : "";
  const anchor = `job-${notification.jkNumber.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`;
  return `${opsCenterOrigin()}/jobs${date ? `?date=${encodeURIComponent(date)}` : ""}#${anchor}`;
}

function categoryLabel(category: WhatsAppPhotoSlackNotification["category"]): string {
  return category === "before" ? "Before" : category === "donation" ? "Donation / receipt" : "After";
}

export function formatWhatsAppPhotoSlackNotification(notification: WhatsAppPhotoSlackNotification): string {
  const receivedAt = new Date(notification.receivedAt);
  const received = Number.isNaN(receivedAt.getTime())
    ? "WhatsApp Business"
    : `<!date^${Math.floor(receivedAt.getTime() / 1_000)}^{date_short_pretty} at {time}|WhatsApp Business>`;
  return [
    `:camera_with_flash: *OpsBot received a photo for <${jobHref(notification)}|${slackEscape(notification.jkNumber)}>*`,
    `*Category:* ${categoryLabel(notification.category)} · *Received:* ${received}`,
    "The sender supplied the JK number; OpsCenter matched the photo and queued it for verified JunkWare upload.",
  ].join("\n");
}

export function queueWhatsAppPhotoSlackNotification(input: {
  messageId: string;
  jkNumber: string;
  category: WhatsAppPhotoSlackNotification["category"];
  receivedAt: string;
  jobDate: string;
}): { duplicate: boolean } {
  ensureDirectories();
  const notification: WhatsAppPhotoSlackNotification = {
    version: 1,
    messageId: clean(input.messageId),
    jkNumber: clean(input.jkNumber).toUpperCase(),
    category: input.category,
    receivedAt: clean(input.receivedAt),
    jobDate: clean(input.jobDate),
    queuedAt: new Date().toISOString(),
  };
  if (!notification.messageId || !/^JK\d{4,12}$/.test(notification.jkNumber)) {
    throw new Error("The WhatsApp Slack notification is missing a valid message or JK number.");
  }
  const pending = notificationFile("pending", notification.messageId);
  const delivered = notificationFile("delivered", notification.messageId);
  if (fs.existsSync(pending) || fs.existsSync(delivered)) return { duplicate: true };
  try {
    fs.writeFileSync(pending, `${JSON.stringify(notification, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return { duplicate: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { duplicate: true };
    throw error;
  }
}

function pendingNotifications(limit: number, now: Date): Array<{ file: string; notification: WhatsAppPhotoSlackNotification }> {
  ensureDirectories();
  return fs.readdirSync(notificationDirectory("pending"))
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
    .sort()
    .flatMap((name) => {
      const file = path.join(notificationDirectory("pending"), name);
      try {
        const notification = JSON.parse(fs.readFileSync(file, "utf8")) as WhatsAppPhotoSlackNotification;
        const nextAttemptAt = new Date(clean(notification.nextAttemptAt)).getTime();
        if (Number.isFinite(nextAttemptAt) && nextAttemptAt > now.getTime()) return [];
        return [{ file, notification }];
      } catch {
        return [];
      }
    })
    .slice(0, Math.max(0, limit));
}

function clientMessageId(messageId: string): string {
  const digest = recordKey(messageId);
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
  const allPending = fs.readdirSync(notificationDirectory("pending"))
    .filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).length;
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

  for (const { file, notification } of pendingNotifications(options?.limit ?? 10, now)) {
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
          text: formatWhatsAppPhotoSlackNotification(notification),
          mrkdwn: true,
          unfurl_links: false,
          unfurl_media: false,
          client_msg_id: clientMessageId(notification.messageId),
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
      const delivered = notificationFile("delivered", notification.messageId);
      writeJsonAtomic(delivered, {
        ...notification,
        deliveredAt: now.toISOString(),
        slackChannelId: channelId,
        slackMessageTs: responsePayload.ts,
      });
      fs.unlinkSync(file);
      result.delivered += 1;
      result.pending -= 1;
      continue;
    }

    const attempts = Math.max(0, Number(notification.attempts) || 0) + 1;
    const nextAttemptAt = new Date(now.getTime() + retryDelaySeconds(attempts, retryAfterSeconds) * 1_000).toISOString();
    writeJsonAtomic(file, {
      ...notification,
      attempts,
      lastAttemptAt: now.toISOString(),
      lastError: clean(responsePayload.error || "Slack did not accept the notification").slice(0, 200),
      nextAttemptAt,
    });
    result.failed += 1;
  }
  return result;
}
