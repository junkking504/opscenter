import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ActionVerification } from "@/lib/platform/contracts";
import { getPodiumConfig } from "@/lib/podium-config";
import { buildPodiumGoogleReviewsView } from "@/lib/podium-reviews";
import { podiumTokenStoreStatus } from "@/lib/podium-token-store";
import { getOpsRuntime } from "@/lib/runtime";
import { formatSlackMessage } from "@/lib/slack-message-format";

export type CommunicationsControlMode = "live_control" | "preview_simulation";

export type InternalSlackNoticeInput = {
  subject: string;
  message: string;
  owner: string;
  nextAction: string;
};

export type InternalSlackNoticeReceipt = {
  mode: CommunicationsControlMode;
  posted: boolean;
  verified: boolean;
  channelId: string;
  channelLabel: "#ops-command";
  messageTs: string;
  clientMessageId: string;
  summary: string;
  evidence: Record<string, unknown>;
};

export type CommunicationsControlSnapshot = {
  date: string;
  mode: CommunicationsControlMode;
  source: "Slack delivery state + WhatsApp durable queues + Podium Reviews";
  sourceObservedAt: string;
  slack: {
    enabled: boolean;
    credentialAvailable: boolean;
    commandChannelConfigured: boolean;
    stateUpdatedAt: string;
    activeIncidents: number;
    deliveredToday: number;
  };
  whatsapp: {
    photos: {
      incoming: number;
      processing: number;
      completed: number;
      review: number;
      failed: number;
    };
    photoConfirmations: { pending: number; delivered: number };
    slackPhotoBatches: { pending: number; delivered: number };
    expenses: {
      pending: number;
      processing: number;
      completed: number;
      failed: number;
      review: number;
    };
    replies: { pending: number; processing: number; sent: number; failed: number };
  };
  podium: {
    connected: boolean;
    scopes: readonly string[];
    snapshotFetchedAt: string;
    locations: number;
    recentNeedsResponse: number;
    recentLowRatings: number;
    pendingAttribution: number;
    newToday: number;
  };
  warning?: string;
  authorityNotice: string;
};

type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  channel?: string;
  ts?: string;
};

const DEFAULT_COMMAND_CHANNEL_ID = "C0BNMDJNYV9";

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function boolValue(value: unknown): boolean {
  return /^(1|true|yes|on)$/i.test(clean(value));
}

function dataRoot(): string {
  return clean(process.env.OPSBOT_DATA_DIR) || path.join(process.cwd(), "data");
}

function environmentFileValues(file: string): Record<string, string> {
  try {
    if (!fs.existsSync(file)) return {};
    return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line) => {
      const value = line.trim();
      if (!value || value.startsWith("#")) return [];
      const separator = value.indexOf("=");
      if (separator < 1) return [];
      const key = value.slice(0, separator).trim();
      let entry = value.slice(separator + 1).trim();
      if ((entry.startsWith("'") && entry.endsWith("'")) || (entry.startsWith('"') && entry.endsWith('"'))) {
        entry = entry.slice(1, -1);
      }
      return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? [[key, entry]] : [];
    }));
  } catch {
    return {};
  }
}

function slackConfiguration(): Record<string, string> {
  const explicitFile = clean(process.env.OPSCENTER_SLACK_ENV_FILE);
  const candidates = [
    path.join(os.homedir(), "Library", "Application Support", "OpsCenter", "slack.env"),
    path.join(process.cwd(), ".env.slack.local"),
    explicitFile,
  ].filter(Boolean);
  const values = candidates.reduce<Record<string, string>>(
    (merged, file) => ({ ...merged, ...environmentFileValues(file) }),
    {},
  );
  for (const key of ["SLACK_OPSCENTER_ALERTS_ENABLED", "SLACK_OPS_COMMAND_CHANNEL_ID", "SLACK_OPSCENTER_BASE_URL"]) {
    const configured = clean(process.env[key]);
    if (configured) values[key] = configured;
  }
  return values;
}

function slackBotToken(): string {
  const configured = clean(process.env.SLACK_BOT_TOKEN);
  if (configured) return configured;
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-a", "opscenter", "-s", "com.opscenter.slack-bot-token", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 },
    ).trim();
  } catch {
    return "";
  }
}

function commandChannelId(): string {
  return clean(slackConfiguration().SLACK_OPS_COMMAND_CHANNEL_ID) || DEFAULT_COMMAND_CHANNEL_ID;
}

function readJson(file: string): Record<string, any> {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function jsonCount(directory: string): number {
  try {
    return fs.readdirSync(directory).filter((entry) => entry.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function modifiedAt(target: string): string {
  try {
    return fs.statSync(target).mtime.toISOString();
  } catch {
    return "";
  }
}

function dateDeliveries(state: Record<string, any>, date: string): number {
  return [
    "deliveredScheduleChangesByDate",
    "deliveredCrewNotificationsByDate",
    "deliveredTruckArrivalsByDate",
    "deliveredTruckCloseoutsByDate",
    "deliveredPaymentNotificationsByDate",
  ].reduce((total, key) => total + (Array.isArray(state?.[key]?.[date]) ? state[key][date].length : 0), 0);
}

export function communicationsControlMode(): CommunicationsControlMode {
  return getOpsRuntime() === "MISSION_CONTROL" ? "live_control" : "preview_simulation";
}

export function readCommunicationsControlSnapshot(date: string): CommunicationsControlSnapshot {
  const root = dataRoot();
  const slackStateFile = clean(process.env.SLACK_OPSCENTER_STATE_FILE)
    || path.join(root, "slack", "ops_alert_state.json");
  const slackState = readJson(slackStateFile);
  const slackConfig = slackConfiguration();
  const photoRoot = clean(process.env.WHATSAPP_JOB_PHOTO_STATE_DIR)
    || path.join(root, "integrations", "whatsapp-job-photos");
  const expenseRoot = clean(process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR)
    || path.join(root, "integrations", "whatsapp-crew-expenses");
  const podiumConfig = getPodiumConfig();
  const podiumToken = podiumTokenStoreStatus();
  const podium = buildPodiumGoogleReviewsView();
  const photoQueue = {
    incoming: jsonCount(path.join(photoRoot, "incoming")),
    processing: jsonCount(path.join(photoRoot, "processing")),
    completed: jsonCount(path.join(photoRoot, "completed")),
    review: jsonCount(path.join(photoRoot, "review")),
    failed: jsonCount(path.join(photoRoot, "failed")),
  };
  const replies = {
    pending: jsonCount(path.join(expenseRoot, "outbox-incoming")),
    processing: jsonCount(path.join(expenseRoot, "outbox-processing")),
    sent: jsonCount(path.join(expenseRoot, "outbox-sent")),
    failed: jsonCount(path.join(expenseRoot, "outbox-failed")),
  };
  const sourceObservedAt = [
    clean(slackState.updatedAt),
    podium.snapshot?.fetchedAt || "",
    modifiedAt(path.join(photoRoot, "completed")),
    modifiedAt(path.join(photoRoot, "review")),
    modifiedAt(path.join(expenseRoot, "outbox-sent")),
  ].filter(Boolean).sort().at(-1) || "";
  const warningParts = [
    photoQueue.review ? `${photoQueue.review} WhatsApp photos need review` : "",
    photoQueue.failed ? `${photoQueue.failed} WhatsApp photos failed` : "",
    replies.failed ? `${replies.failed} WhatsApp replies failed` : "",
  ].filter(Boolean);
  return {
    date,
    mode: communicationsControlMode(),
    source: "Slack delivery state + WhatsApp durable queues + Podium Reviews",
    sourceObservedAt,
    slack: {
      enabled: boolValue(slackConfig.SLACK_OPSCENTER_ALERTS_ENABLED),
      credentialAvailable: slackBotToken().startsWith("xoxb-"),
      commandChannelConfigured: Boolean(commandChannelId()),
      stateUpdatedAt: clean(slackState.updatedAt),
      activeIncidents: slackState.active && typeof slackState.active === "object"
        ? Object.keys(slackState.active).length
        : 0,
      deliveredToday: dateDeliveries(slackState, date),
    },
    whatsapp: {
      photos: photoQueue,
      photoConfirmations: {
        pending: jsonCount(path.join(photoRoot, "whatsapp-confirmations", "pending")),
        delivered: jsonCount(path.join(photoRoot, "whatsapp-confirmations", "delivered")),
      },
      slackPhotoBatches: {
        pending: jsonCount(path.join(photoRoot, "slack-notifications", "batches", "pending")),
        delivered: jsonCount(path.join(photoRoot, "slack-notifications", "batches", "delivered")),
      },
      expenses: {
        pending: jsonCount(path.join(expenseRoot, "transactions-pending")),
        processing: jsonCount(path.join(expenseRoot, "transactions-processing")),
        completed: jsonCount(path.join(expenseRoot, "transactions-completed")),
        failed: jsonCount(path.join(expenseRoot, "transactions-failed")),
        review: jsonCount(path.join(expenseRoot, "review")),
      },
      replies,
    },
    podium: {
      connected: podiumConfig.ready && podiumToken.connected,
      scopes: podiumConfig.scopes,
      snapshotFetchedAt: podium.snapshot?.fetchedAt || "",
      locations: podium.locations.length,
      recentNeedsResponse: podium.recentNeedsResponse,
      recentLowRatings: podium.recentLowRatings,
      pendingAttribution: podium.pendingAttribution30Days,
      newToday: podium.newToday,
    },
    warning: warningParts.length ? `${warningParts.join(" · ")}.` : undefined,
    authorityNotice: "Only the internal Ops Command Slack notice is writable. WhatsApp sends remain worker-controlled after verified JunkWare outcomes; Podium response writes are unavailable under the approved read-only scopes.",
  };
}

function clientMessageId(actionRunId: string): string {
  const normalized = clean(actionRunId).toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    return normalized;
  }
  const value = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 32).split("");
  value[12] = "4";
  value[16] = ["8", "9", "a", "b"][Number.parseInt(value[16], 16) % 4];
  const hex = value.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function executeInternalSlackNotice(
  input: InternalSlackNoticeInput,
  actionRunId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InternalSlackNoticeReceipt> {
  const mode = communicationsControlMode();
  const channelId = commandChannelId();
  const clientId = clientMessageId(actionRunId);
  if (mode === "preview_simulation") {
    return {
      mode,
      posted: false,
      verified: true,
      channelId,
      channelLabel: "#ops-command",
      messageTs: `preview-${clientId}`,
      clientMessageId: clientId,
      summary: "Preview simulation verified; no Slack message was sent.",
      evidence: { channel: "#ops-command", delivery: "simulated", clientMessageId: clientId },
    };
  }
  const config = slackConfiguration();
  if (!boolValue(config.SLACK_OPSCENTER_ALERTS_ENABLED)) {
    throw new Error("Slack OpsCenter delivery is not enabled.");
  }
  if (!/^[A-Z][A-Z0-9]{8,}$/.test(channelId)) {
    throw new Error("The owned Ops Command Slack channel is invalid.");
  }
  const token = slackBotToken();
  if (!token.startsWith("xoxb-")) throw new Error("The Slack bot credential is unavailable.");
  const baseUrl = clean(config.SLACK_OPSCENTER_BASE_URL || "https://ops.junk-king.app").replace(/\/$/, "");
  const text = formatSlackMessage({
    icon: ":loudspeaker:",
    title: input.subject,
    fields: [
      { label: "Owner", value: input.owner },
      { label: "Approved via", value: "OpsBot Control" },
    ],
    body: input.message,
    nextAction: input.nextAction,
    href: `${baseUrl}/?section=opsbot`,
  });
  const response = await fetchImpl("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: channelId,
      text,
      mrkdwn: true,
      unfurl_links: false,
      unfurl_media: false,
      client_msg_id: clientId,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({ ok: false, error: `http_${response.status}` })) as SlackApiResponse;
  if (!response.ok || !payload.ok || !clean(payload.ts)) {
    throw new Error(`Slack did not accept the internal notice (${clean(payload.error) || `http_${response.status}`}).`);
  }
  if (clean(payload.channel) && clean(payload.channel) !== channelId) {
    throw new Error("Slack returned a different channel for the internal notice.");
  }
  const messageTs = clean(payload.ts);
  return {
    mode,
    posted: true,
    verified: true,
    channelId,
    channelLabel: "#ops-command",
    messageTs,
    clientMessageId: clientId,
    summary: "Internal Ops Command notice accepted by Slack with a delivery timestamp.",
    evidence: { channel: "#ops-command", messageTs, clientMessageId: clientId },
  };
}

export async function verifyInternalSlackNotice(
  receipt: InternalSlackNoticeReceipt,
): Promise<ActionVerification> {
  if (!receipt.verified || !receipt.messageTs || receipt.channelLabel !== "#ops-command") {
    return { outcome: "mismatch", summary: "The internal Slack notice did not return the expected delivery receipt." };
  }
  return {
    outcome: "verified",
    verifiedAt: new Date().toISOString(),
    summary: receipt.summary,
    evidence: receipt.evidence,
  };
}
