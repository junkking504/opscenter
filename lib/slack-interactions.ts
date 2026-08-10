import { createHmac, timingSafeEqual } from "node:crypto";
import {
  transitionOpsAction,
  type OpsAction,
  type OpsActionOperation,
} from "@/lib/ops-actions";

type SlackInteractionPayload = {
  type?: string;
  team?: { id?: string };
  user?: { id?: string; username?: string; name?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
  response_url?: string;
};

export type SlackInteractionResult = {
  ok: boolean;
  status: number;
  message: string;
  action: OpsAction | null;
  responseUrl: string;
};

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function verifySlackSignature(input: {
  rawBody: string;
  timestamp: string;
  signature: string;
  signingSecret: string;
  now?: Date;
}): boolean {
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds) || !input.signature.startsWith("v0=")) return false;
  const nowSeconds = Math.floor((input.now || new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > 60 * 5) return false;
  const expected = `v0=${createHmac("sha256", input.signingSecret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest("hex")}`;
  return safeEqual(expected, input.signature);
}

function operationForActionId(actionId: string): { operation: OpsActionOperation; snoozeMinutes?: number } | null {
  if (actionId === "ops_action_acknowledge") return { operation: "acknowledge" };
  if (actionId === "ops_action_snooze_60") return { operation: "snooze", snoozeMinutes: 60 };
  if (actionId === "ops_action_handle") return { operation: "handle" };
  if (actionId === "ops_action_reopen") return { operation: "reopen" };
  return null;
}

export function parseSlackInteraction(rawBody: string): SlackInteractionPayload | null {
  try {
    const encodedPayload = new URLSearchParams(rawBody).get("payload");
    if (!encodedPayload) return null;
    const payload = JSON.parse(encodedPayload);
    return payload && typeof payload === "object" ? payload as SlackInteractionPayload : null;
  } catch {
    return null;
  }
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1))}…`;
}

function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function statusLabel(action: OpsAction): string {
  if (action.status === "acknowledged") return `Acknowledged${action.ownerLabel ? ` by ${action.ownerLabel}` : ""}`;
  if (action.status === "snoozed") {
    const until = action.snoozedUntil
      ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(new Date(action.snoozedUntil))
      : "later";
    return `Snoozed until ${until}${action.ownerLabel ? ` by ${action.ownerLabel}` : ""}`;
  }
  if (action.status === "handled") return `Marked handled${action.ownerLabel ? ` by ${action.ownerLabel}` : ""}`;
  if (action.status === "resolved") return "Resolved after the source condition cleared";
  return "Open";
}

export function buildSlackActionBlocks(action: OpsAction, interactive = true): Array<Record<string, unknown>> {
  const icon = action.severity === "critical" ? ":rotating_light:" : ":warning:";
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncate(`${icon} *${slackEscape(action.title)}*\n${slackEscape(action.detail)}`, 2_900),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncate(`*Next:* ${slackEscape(action.nextAction)}`, 2_900),
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `*Status:* ${slackEscape(statusLabel(action))} · Action ID: \`${action.actionId}\`` }],
    },
  ];

  const elements: Array<Record<string, unknown>> = [];
  if (interactive && action.status === "open") {
    elements.push({ type: "button", action_id: "ops_action_acknowledge", text: { type: "plain_text", text: "Acknowledge" }, style: "primary", value: action.actionId });
  }
  if (interactive && ["open", "acknowledged"].includes(action.status)) {
    elements.push({ type: "button", action_id: "ops_action_snooze_60", text: { type: "plain_text", text: "Snooze 1 hour" }, value: action.actionId });
  }
  if (interactive && ["open", "acknowledged", "snoozed"].includes(action.status)) {
    elements.push({ type: "button", action_id: "ops_action_handle", text: { type: "plain_text", text: "Mark handled" }, value: action.actionId });
  }
  if (interactive && action.status === "handled" && action.sourceActive) {
    elements.push({ type: "button", action_id: "ops_action_reopen", text: { type: "plain_text", text: "Reopen" }, value: action.actionId });
  }
  elements.push({ type: "button", action_id: "ops_action_open", text: { type: "plain_text", text: "Open OpsCenter" }, url: action.href });
  blocks.push({ type: "actions", elements });
  return blocks;
}

export function applySlackInteraction(payload: SlackInteractionPayload, now = new Date()): SlackInteractionResult {
  if (payload.type !== "block_actions") {
    return { ok: false, status: 400, message: "Unsupported Slack interaction.", action: null, responseUrl: "" };
  }
  const configuredTeamId = String(process.env.SLACK_TEAM_ID || "").trim();
  if (configuredTeamId && payload.team?.id !== configuredTeamId) {
    return { ok: false, status: 403, message: "Slack workspace mismatch.", action: null, responseUrl: "" };
  }
  const slackAction = payload.actions?.[0];
  const transition = operationForActionId(String(slackAction?.action_id || ""));
  const actionId = String(slackAction?.value || "").trim();
  if (!transition || !actionId) {
    return { ok: false, status: 400, message: "Unknown OpsCenter action.", action: null, responseUrl: "" };
  }
  const userId = String(payload.user?.id || "").trim();
  const userLabel = String(payload.user?.username || payload.user?.name || userId || "Slack user").trim();
  const action = transitionOpsAction({
    actionId,
    operation: transition.operation,
    snoozeMinutes: transition.snoozeMinutes,
    actor: { source: "slack", id: userId || "slack-user", label: userLabel.slice(0, 160) },
    now,
  });
  if (!action) {
    return { ok: false, status: 404, message: "This OpsCenter action no longer exists.", action: null, responseUrl: "" };
  }
  return {
    ok: true,
    status: 200,
    message: statusLabel(action),
    action,
    responseUrl: String(payload.response_url || "").trim(),
  };
}

export async function refreshSlackInteractionMessage(responseUrl: string, action: OpsAction): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(responseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com" || !url.pathname.startsWith("/actions/")) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_750);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        replace_original: true,
        text: `OpsCenter action: ${action.title} — ${statusLabel(action)}`,
        blocks: buildSlackActionBlocks(action, true),
      }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
