import crypto from "node:crypto";
import { formatOpsCenterSlackMessage } from "@/lib/slack-message-format";
import { truckSlackChannelId } from "@/lib/slack-truck-channels";
import type { CrewExpenseRecord } from "@/lib/whatsapp-crew-expenses";

type SlackResponse = { ok?: boolean; ts?: string; error?: string };

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clientMessageId(messageId: string, operation = "create"): string {
  const digest = crypto.createHash("sha256").update(`crew-expense:${operation}:${messageId}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function formatCrewExpenseSlackNotification(record: CrewExpenseRecord): string {
  const detail = record.kind === "fuel"
    ? `${record.gallons} gal`
    : record.weight || "no weight";
  return formatOpsCenterSlackMessage({
    title: `[${record.kind === "fuel" ? "Fuel" : "Dump"} Recorded]`,
    subject: record.truck,
    fields: [
      { label: "Location", value: record.location },
      { label: "Cost", value: `$${record.cost.toFixed(2)}` },
      { label: record.kind === "fuel" ? "Gallons" : "Weight", value: detail },
      { label: "Time", value: record.time },
    ],
  });
}

export function formatCrewExpenseSlackCorrectionNotification(record: CrewExpenseRecord): string {
  const detail = record.kind === "fuel"
    ? `${record.gallons} gal`
    : record.weight || "no weight";
  return formatOpsCenterSlackMessage({
    title: `[${record.kind === "fuel" ? "Fuel" : "Dump"} Corrected]`,
    subject: record.truck,
    fields: [
      { label: "Location", value: record.location },
      { label: "Cost", value: `$${record.cost.toFixed(2)}` },
      { label: record.kind === "fuel" ? "Gallons" : "Weight", value: detail },
      { label: "Time", value: record.time },
    ],
  });
}

export async function sendCrewExpenseSlackNotification(
  record: CrewExpenseRecord,
  fetchImpl: typeof fetch = fetch,
): Promise<{ channel: string; ts: string; clientMessageId: string }> {
  if (!/^(1|true|yes|on)$/i.test(clean(process.env.SLACK_OPSCENTER_ALERTS_ENABLED))) {
    throw new Error("OpsCenter Slack alerts are disabled.");
  }
  const token = clean(process.env.SLACK_BOT_TOKEN);
  if (!token.startsWith("xoxb-")) throw new Error("The OpsCenter Slack bot token is unavailable.");
  const fallback = clean(process.env.SLACK_WHATSAPP_EXPENSE_CHANNEL_ID || process.env.SLACK_WHATSAPP_PHOTO_CHANNEL_ID || "C0BNRMD25AS");
  const channel = truckSlackChannelId(record.truck, fallback);
  if (!channel) throw new Error("No Slack channel is configured for this truck expense.");
  const dedupeId = clientMessageId(record.messageId);
  const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text: formatCrewExpenseSlackNotification(record), client_msg_id: dedupeId, unfurl_links: false, unfurl_media: false }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as SlackResponse;
  if (!response.ok || !payload.ok || !clean(payload.ts)) {
    throw new Error(`Slack expense alert failed (${response.status}${payload.error ? `: ${clean(payload.error)}` : ""}).`);
  }
  return { channel, ts: clean(payload.ts), clientMessageId: dedupeId };
}

export async function sendCrewExpenseSlackCorrectionNotification(
  record: CrewExpenseRecord,
  correctionMessageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ channel: string; ts: string; clientMessageId: string }> {
  if (!/^(1|true|yes|on)$/i.test(clean(process.env.SLACK_OPSCENTER_ALERTS_ENABLED))) {
    throw new Error("OpsCenter Slack alerts are disabled.");
  }
  const token = clean(process.env.SLACK_BOT_TOKEN);
  if (!token.startsWith("xoxb-")) throw new Error("The OpsCenter Slack bot token is unavailable.");
  const fallback = clean(process.env.SLACK_WHATSAPP_EXPENSE_CHANNEL_ID || process.env.SLACK_WHATSAPP_PHOTO_CHANNEL_ID || "C0BNRMD25AS");
  const channel = truckSlackChannelId(record.truck, fallback);
  if (!channel) throw new Error("No Slack channel is configured for this truck expense.");
  const dedupeId = clientMessageId(correctionMessageId, "edit");
  const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text: formatCrewExpenseSlackCorrectionNotification(record), client_msg_id: dedupeId, unfurl_links: false, unfurl_media: false }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as SlackResponse;
  if (!response.ok || !payload.ok || !clean(payload.ts)) {
    throw new Error(`Slack expense correction alert failed (${response.status}${payload.error ? `: ${clean(payload.error)}` : ""}).`);
  }
  return { channel, ts: clean(payload.ts), clientMessageId: dedupeId };
}
