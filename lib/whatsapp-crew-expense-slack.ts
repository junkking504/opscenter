import crypto from "node:crypto";
import { formatSlackMessage } from "@/lib/slack-message-format";
import { truckSlackChannelId } from "@/lib/slack-truck-channels";
import type { CrewExpenseRecord } from "@/lib/whatsapp-crew-expenses";

type SlackResponse = { ok?: boolean; ts?: string; error?: string };

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clientMessageId(messageId: string): string {
  const digest = crypto.createHash("sha256").update(`crew-expense:${messageId}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function formatCrewExpenseSlackNotification(record: CrewExpenseRecord): string {
  const isFuel = record.kind === "fuel";
  return formatSlackMessage({
    icon: isFuel ? ":fuelpump:" : ":wastebasket:",
    title: `${isFuel ? "Fuel" : "Dump"} receipt recorded`,
    fields: [
      { label: "Truck", value: record.truck },
      { label: "Location", value: record.location },
      { label: "Amount", value: `$${record.cost.toFixed(2)}` },
      { label: isFuel ? "Gallons" : "Weight", value: isFuel ? `${record.gallons} gal` : record.weight || "Not recorded" },
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
