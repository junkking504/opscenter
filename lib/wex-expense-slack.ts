import crypto from "node:crypto";
import { formatSlackMessage } from "@/lib/slack-message-format";
import { truckSlackChannelId } from "@/lib/slack-truck-channels";
import type { WexExpenseAutomation } from "@/lib/wex-expense-automation";

const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
function clientMessageId(transactionId: string): string {
  const digest = crypto.createHash("sha256").update(`wex-expense:${transactionId}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
export function formatWexExpenseSlackNotification(automation: WexExpenseAutomation): string {
  const { transaction, record, attribution } = automation;
  return formatSlackMessage({ icon: ":fuelpump:", title: "WEX posted fuel transaction", fields: [
    { label: "Truck", value: record.truck }, { label: "Amount", value: `$${record.cost.toFixed(2)}` },
    { label: "Merchant", value: transaction.merchant || "Not recorded" },
    { label: "Location", value: [transaction.merchantAddress, transaction.city, transaction.state].filter(Boolean).join(", ") || "Not recorded" },
    { label: "Transaction time", value: `${transaction.transactionDate} ${transaction.transactionTime}` },
    { label: "Gallons", value: transaction.gallons === null ? "Not recorded" : `${transaction.gallons} gal` },
    { label: "Truck attribution", value: `LinxUp ${attribution.evidence}` },
    { label: "Expense record", value: automation.action === "matched_existing" ? "Matched the existing JunkWare/manual expense; no duplicate created." : "Created and verified in JunkWare." },
  ] });
}
export async function sendWexExpenseSlackNotification(automation: WexExpenseAutomation, fetchImpl: typeof fetch = fetch) {
  if (!/^(1|true|yes|on)$/i.test(clean(process.env.SLACK_OPSCENTER_ALERTS_ENABLED))) throw new Error("OpsCenter Slack alerts are disabled.");
  const token = clean(process.env.SLACK_BOT_TOKEN);
  if (!token.startsWith("xoxb-")) throw new Error("The OpsCenter Slack bot token is unavailable.");
  const fallback = clean(process.env.SLACK_WHATSAPP_EXPENSE_CHANNEL_ID || process.env.SLACK_WHATSAPP_PHOTO_CHANNEL_ID || "C0BNRMD25AS");
  const channel = truckSlackChannelId(automation.record.truck, fallback);
  if (!channel) throw new Error("No Slack channel is configured for this WEX expense.");
  const dedupeId = clientMessageId(automation.transaction.transactionId);
  const response = await fetchImpl("https://slack.com/api/chat.postMessage", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel, text: formatWexExpenseSlackNotification(automation), client_msg_id: dedupeId, unfurl_links: false, unfurl_media: false }), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; ts?: string; error?: string };
  if (!response.ok || !payload.ok || !clean(payload.ts)) throw new Error(`Slack WEX expense alert failed (${response.status}${payload.error ? `: ${clean(payload.error)}` : ""}).`);
  return { channel, ts: clean(payload.ts), clientMessageId: dedupeId };
}
