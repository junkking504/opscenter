import { execFileSync } from "node:child_process";
import {
  buildAddOnAppointmentFeed,
  buildCancelledAppointmentFeed,
  type AddOnAppointment,
} from "@/lib/add-on-notifications";
import {
  buildAddOnSlackNotification,
  buildCancellationSlackNotification,
  formatSlackAlert,
  slackPhoneLink,
} from "@/lib/slack-alerts";
import type { AnyRecord } from "@/lib/opsData";
import { slackEscape } from "@/lib/slack-message-format";
import { readCompletedJunkwareRows, truckCloseoutDetails } from "@/lib/slack-closeout-details";

const CHICAGO_TIME_ZONE = "America/Chicago";
// The client checks more frequently, while this shared cache keeps aggregate
// Slack history reads safely below the workspace method limits.
const CACHE_TTL_MS = 30_000;

const DEFAULT_CHANNEL_NAMES: Record<string, string> = {
  C0BNMDJNYV9: "#ops-command",
  C0BNRMD25AS: "#ops-dispatch",
  C0BNQ6J7LER: "#ops-fleet",
  C0BNVJR6HMX: "#ops-finance",
  C0BNXBK8GTW: "#ops-growth",
  C0BPN1FVCDN: "#ops-data-health",
  C0BPS5MS406: "#payments",
  C0BPRML654N: "#jobs-no",
  C0BPQ30C8LD: "#jobs-br",
  C0BPC9M5GLX: "#jobs-ns",
  C0BPU3XUANN: "#truck-1",
  C0BPQGBD4N9: "#truck-2",
  C0BPQGARS1K: "#truck-3",
  C0BQNEV0GFJ: "#truck-4",
  C0BPXQJACS0: "#truck-6",
  C0BPXQK9ESG: "#truck-7",
  C0BPMSJ7V43: "#truck-8",
  C0BPCP2B6BH: "#truck-9",
};

type SlackMessagePayload = {
  ts?: string;
  thread_ts?: string;
  text?: string;
  subtype?: string;
  user?: string;
  username?: string;
  bot_profile?: { name?: string };
  reply_count?: number;
};

type SlackHistoryResponse = {
  ok?: boolean;
  error?: string;
  messages?: SlackMessagePayload[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
};

export type SlackDigestMessage = {
  id: string;
  timestamp: string;
  channel: string;
  rawText: string;
  text: string;
  threadReply: boolean;
  opsCenterHref?: string;
  appointment?: {
    title: string;
    jobNumber: string;
    customerName: string;
    phone: string;
    appointmentTime: string;
    address: string;
    items: string[];
    href: string;
    nextAction: string;
  };
  closeout?: {
    jobNumber: string;
    lines: string[];
    href: string;
  };
};

export type SlackDailyDigest = {
  date: string;
  messages: SlackDigestMessage[];
  status: "ready" | "unavailable";
  detail?: string;
  refreshedAt: string;
};

type DigestCacheEntry = {
  expiresAt: number;
  value: Promise<SlackDailyDigest>;
};

const digestCache = new Map<string, DigestCacheEntry>();

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function zonedMidnightSeconds(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const intendedUtc = Date.UTC(year, month - 1, day);
  let candidate = intendedUtc;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
    );
    const representedUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    candidate += intendedUtc - representedUtc;
  }

  return Math.floor(candidate / 1_000);
}

function slackToken(): string {
  const configured = String(process.env.SLACK_BOT_TOKEN || "").trim();
  if (configured.startsWith("xoxb-")) return configured;
  if (process.platform !== "darwin") return "";

  try {
    const token = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-a", "opscenter", "-s", "com.opscenter.slack-bot-token", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3_000 },
    ).trim();
    return token.startsWith("xoxb-") ? token : "";
  } catch {
    return "";
  }
}

export function slackDigestChannelIds(): string[] {
  const configured = Object.entries(process.env)
    .filter(([name, value]) => /^SLACK_.*_CHANNEL_ID$/.test(name) && /^C[A-Z0-9]+$/.test(String(value || "").trim()))
    .map(([, value]) => String(value).trim());
  return Array.from(new Set([...Object.keys(DEFAULT_CHANNEL_NAMES), ...configured]));
}

function configuredChannelName(channelId: string): string {
  const entry = Object.entries(process.env).find(
    ([name, value]) => /^SLACK_.*_CHANNEL_ID$/.test(name) && String(value || "").trim() === channelId,
  );
  if (!entry) return "";
  const envName = entry[0];
  const truck = envName.match(/^SLACK_TRUCK_(\d+)_CHANNEL_ID$/);
  if (truck) return `#truck-${truck[1]}`;
  const known: Record<string, string> = {
    SLACK_OPS_COMMAND_CHANNEL_ID: "#ops-command",
    SLACK_OPS_DISPATCH_CHANNEL_ID: "#ops-dispatch",
    SLACK_OPS_CREW_CHANNEL_ID: "#ops-command",
    SLACK_OPS_FLEET_CHANNEL_ID: "#ops-fleet",
    SLACK_OPS_FINANCE_CHANNEL_ID: "#ops-finance",
    SLACK_OPS_GROWTH_CHANNEL_ID: "#ops-growth",
    SLACK_OPS_DATA_HEALTH_CHANNEL_ID: "#ops-data-health",
    SLACK_OPS_PAYMENT_CHANNEL_ID: "#payments",
    SLACK_JOBS_NO_CHANNEL_ID: "#jobs-no",
    SLACK_JOBS_BR_CHANNEL_ID: "#jobs-br",
    SLACK_JOBS_NS_CHANNEL_ID: "#jobs-ns",
  };
  return known[envName] || "";
}

export function slackDigestChannelName(channelId: string): string {
  return configuredChannelName(channelId) || DEFAULT_CHANNEL_NAMES[channelId] || "#slack";
}

export function slackTextToPlainText(value: string): string {
  const emoji: Record<string, string> = {
    rotating_light: "🚨",
    warning: "⚠️",
    x: "❌",
    white_check_mark: "✅",
    truck: "🚚",
    camera_with_flash: "📸",
    wastebasket: "🗑️",
    fuelpump: "⛽",
  };

  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/^\s*_?Alert ID:.*_?\s*$/gim, "")
    .replace(/^\s*<https?:\/\/[^>|]+\|Open in OpsCenter>\s*$/gim, "")
    .replace(/<(https?:\/\/[^>|]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/<@[^>]+>/g, "@Slack member")
    .replace(/<#[^>|]+\|([^>]+)>/g, "#$1")
    .replace(/<!channel>/g, "@channel")
    .replace(/<!here>/g, "@here")
    .replace(/:([a-z0-9_+-]+):/gi, (match, name: string) => emoji[name] || name.replace(/_/g, " "))
    .replace(/[*_~`]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function opsCenterHref(value: string): string | undefined {
  const match = String(value || "").match(/<(https?:\/\/[^>|]+)\|Open in OpsCenter>/i);
  if (!match) return undefined;
  try {
    const url = new URL(match[1]);
    if (url.pathname !== "/jobs") return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

function appointmentLookup(appointments: AddOnAppointment[]): Map<string, AddOnAppointment> {
  const lookup = new Map<string, AddOnAppointment>();
  for (const appointment of appointments) {
    if (appointment.id) lookup.set(appointment.id.toLowerCase(), appointment);
    if (appointment.appointmentId) lookup.set(`appt:${appointment.appointmentId}`.toLowerCase(), appointment);
    if (appointment.jobNumber) lookup.set(`job:${appointment.jobNumber}`.toLowerCase(), appointment);
  }
  return lookup;
}

function appointmentForSlackAlert(
  rawText: string,
  lookup: Map<string, AddOnAppointment>,
): SlackDigestMessage["appointment"] | undefined {
  const plainText = slackTextToPlainText(rawText);
  const legacyTitleMatch = plainText.match(/(?:⚠️\s*)?(New same-day appointment|Appointment cancelled):\s*(JK\d+)/i);
  const addOnTitleMatch = plainText.match(/(?:⚠️\s*)?(New Appointment)\s*\n\s*(JK\d+)/i);
  const cancellationTitleMatch = plainText.match(/(?:❌\s*)?(Cancellation)\s*\n\s*(JK\d+)/i);
  const title = legacyTitleMatch?.[1] || addOnTitleMatch?.[1] || cancellationTitleMatch?.[1];
  const jobNumber = legacyTitleMatch?.[2] || addOnTitleMatch?.[2] || cancellationTitleMatch?.[2];
  if (!title || !jobNumber) return undefined;

  const fingerprintMatch = rawText.match(/Alert ID:\s*(?:add_on|cancellation):\d{4}-\d{2}-\d{2}:(appt:[^\s_*]+)/i);
  const appointment = (
    (fingerprintMatch ? lookup.get(fingerprintMatch[1].toLowerCase()) : undefined)
    || lookup.get(`job:${jobNumber}`.toLowerCase())
  );
  if (!appointment) return undefined;

  const nextAction = plainText
    .split("\n")
    .find((line) => /^Next:\s*/i.test(line))
    ?.replace(/^Next:\s*/i, "")
    .trim() || "";
  return {
    title: title.replace(/^./, (value) => value.toUpperCase()),
    jobNumber: appointment.jobNumber,
    customerName: appointment.customerName,
    phone: appointment.phone,
    appointmentTime: appointment.appointmentTime,
    address: appointment.address,
    items: appointment.items,
    href: appointment.href,
    nextAction,
  };
}

function closeoutLookup(rows: AnyRecord[]): Map<string, AnyRecord> {
  const lookup = new Map<string, AnyRecord>();
  for (const row of rows) {
    const jobNumber = String(row?.job_id || row?.jk_number || row?.job_number || "").trim().toLowerCase();
    if (jobNumber) lookup.set(jobNumber, row);
  }
  return lookup;
}

function closeoutForSlackAlert(
  rawText: string,
  lookup: Map<string, AnyRecord>,
  date: string,
): SlackDigestMessage["closeout"] | undefined {
  const plainText = slackTextToPlainText(rawText);
  const match = plainText.match(/^✅\s*Job Closed\s*\nJob:\s*(JK\d+)/i)
    || plainText.match(/^✅\s*Job Closed\s*\n(JK\d+)/i)
    || plainText.match(/^✅\s*(JK\d+)\s+closed out\./i);
  if (!match) return undefined;
  const details = truckCloseoutDetails(lookup.get(match[1].toLowerCase()) || {});
  if (!details) return undefined;
  return {
    jobNumber: details.jobNumber,
    lines: details.lines,
    href: `/jobs?date=${encodeURIComponent(date)}#job-${details.jobNumber.toLowerCase()}`,
  };
}

/**
 * Repair already-delivered cancellation alerts whose schedule source supplied
 * customer, phone, address, and reason as one combined line. New alerts are
 * normalized by the publisher; this keeps the Command Awareness history in
 * the same layout immediately as well.
 */
export function normalizedCancellationDigestText(rawText: string, date: string): string {
  const match = String(rawText || "").match(
    /^:x:\s*\*Cancellation\*\s*\n\*<(https?:\/\/[^>|]+)\|(JK\d+)>\*\s*\n([^\n]+)\n([^\n]+)\n\*Reason:\*\s*(.+)$/i,
  );
  if (!match) return rawText;

  const [, href, jobNumber, appointmentTime, combinedContact, combinedReason] = match;
  return formatSlackAlert(buildCancellationSlackNotification({
    id: `digest:${jobNumber.toLowerCase()}`,
    appointmentId: "",
    jobNumber,
    territory: "",
    customerName: combinedContact.trim(),
    phone: "",
    address: "",
    appointmentTime: appointmentTime.trim(),
    appointmentType: "",
    assignedTruck: "",
    items: [],
    href,
    cancelledBy: "",
    cancellationReason: combinedReason.trim(),
  }, date));
}

/** Preserve the approved reschedule layout for historical detector alerts too. */
export function normalizedRescheduleDigestText(
  rawText: string,
  appointments: Map<string, AddOnAppointment>,
): string {
  const source = String(rawText || "");
  const titleMatch = source.match(/^:warning:\s*\*(JK\d+)\s+rescheduled\*\s*$/im);
  const jobNumber = titleMatch?.[1];
  const previous = source.match(/^Previous:\s*(.+)$/im)?.[1]?.trim();
  const next = source.match(/^New:\s*(.+)$/im)?.[1]?.trim();
  const href = source.match(/<(https?:\/\/[^>|]+)\|Open in OpsCenter>/i)?.[1];
  const appointment = jobNumber ? appointments.get(`job:${jobNumber}`.toLowerCase()) : undefined;
  if (!jobNumber || !previous || !next || !href || !appointment) return rawText;

  return [
    ":warning: *Rescheduled*",
    `*<${href}|${slackEscape(jobNumber)}>*`,
    `Previous: ${slackEscape(previous)}`,
    `New: ${slackEscape(next)}`,
    appointment.customerName ? `*${slackEscape(appointment.customerName)}*` : "",
    slackPhoneLink(appointment.phone),
    slackEscape(appointment.address),
  ].filter(Boolean).join("\n");
}

function legacyJobNumber(rawText: string): string {
  const source = String(rawText || "");
  return source.match(/\|(JK\d+)>/i)?.[1]
    || slackTextToPlainText(source).match(/\b(JK\d+)\b/i)?.[1]
    || "";
}

function legacyJobHref(rawText: string, jobNumber: string, date: string): string {
  const matches = String(rawText || "").matchAll(/<(https?:\/\/[^>|]+)\|[^>]+>/gi);
  for (const match of matches) {
    try {
      const url = new URL(match[1]);
      if (url.hostname === "ops.junk-king.app" && url.pathname === "/jobs") return url.toString();
    } catch {
      // Fall through to the current-day OpsCenter job link below.
    }
  }
  return `https://ops.junk-king.app/jobs?date=${encodeURIComponent(date)}#job-${jobNumber.toLowerCase()}`;
}

/** Keep historical same-day notices aligned with the current appointment layout. */
export function normalizedLegacyAppointmentDigestText(
  rawText: string,
  appointments: Map<string, AddOnAppointment>,
  date: string,
): string {
  const plainText = slackTextToPlainText(rawText);
  if (!/^(?:⚠️\s*)?New same-day appointment:/i.test(plainText)) return rawText;

  const jobNumber = legacyJobNumber(rawText);
  const appointment = jobNumber ? appointments.get(`job:${jobNumber}`.toLowerCase()) : undefined;
  return appointment ? formatSlackAlert(buildAddOnSlackNotification(appointment, date)) : rawText;
}

/** Keep historical cancellation notices in the approved compact cancellation layout. */
export function normalizedLegacyCancellationDigestText(
  rawText: string,
  appointments: Map<string, AddOnAppointment>,
  date: string,
): string {
  const plainText = slackTextToPlainText(rawText);
  if (!/^(?:⚠️\s*)?Appointment cancelled/i.test(plainText)) return rawText;

  const jobNumber = legacyJobNumber(rawText);
  const appointment = jobNumber ? appointments.get(`job:${jobNumber}`.toLowerCase()) : undefined;
  if (!appointment) return rawText;

  const sourceReason = plainText.match(/^Reason:\s*(.+)$/im)?.[1]?.trim() || "";
  return formatSlackAlert(buildCancellationSlackNotification({
    ...appointment,
    cancelledBy: "",
    cancellationReason: sourceReason,
  }, date));
}

/** Restore the approved closeout shape when the original alert predates it. */
export function normalizedLegacyCloseoutDigestText(
  rawText: string,
  closeouts: Map<string, AnyRecord>,
  date: string,
): string {
  const plainText = slackTextToPlainText(rawText);
  const legacyMatch = plainText.match(/^✅\s*Job Closed\s*\nJob:\s*(JK\d+)/i)
    || plainText.match(/^✅\s*(JK\d+)\s+closed out\.?/i);
  if (!legacyMatch) return rawText;

  const details = truckCloseoutDetails(closeouts.get(legacyMatch[1].toLowerCase()) || {});
  if (!details) return rawText;

  const lines = details.lines.flatMap((line) => {
    const match = line.match(/^([^:]+):\s*(.*?)\.?$/);
    if (!match) return [];
    return [match[1] === "Tips" && !match[2] ? "*Tips:*" : `*${slackEscape(match[1])}:* ${slackEscape(match[2])}`];
  });
  return [
    ":white_check_mark: *Job Closed*",
    `*<${legacyJobHref(rawText, details.jobNumber, date)}|${slackEscape(details.jobNumber)}>*`,
    ...lines,
  ].join("\n");
}

/** Reformat old verification copy without changing the already-delivered Slack message. */
export function normalizedLegacyPhotoDigestText(rawText: string, date: string): string {
  const plainText = slackTextToPlainText(rawText);
  if (!/^(?:📸\s*)?Job photos verified/i.test(plainText)) return rawText;

  const jobNumber = legacyJobNumber(rawText);
  const count = plainText.match(/(?:^|\n)Photos:\s*(\d+)\s+photos?\b/i)?.[1];
  if (!jobNumber || !count) return rawText;

  const noun = count === "1" ? "photo" : "photos";
  return [
    ":camera_with_flash: *Photos Uploaded*",
    `*<${legacyJobHref(rawText, jobNumber, date)}|${slackEscape(jobNumber)}>*`,
    `${count} ${noun}`,
    "Verified",
  ].join("\n");
}

function digestMessage(
  channelId: string,
  message: SlackMessagePayload,
  appointments: Map<string, AddOnAppointment>,
  closeouts: Map<string, AnyRecord>,
  date: string,
): SlackDigestMessage | null {
  const ts = String(message.ts || "").trim();
  const rawText = normalizedLegacyPhotoDigestText(
    normalizedLegacyCloseoutDigestText(
      normalizedLegacyCancellationDigestText(
        normalizedLegacyAppointmentDigestText(
          normalizedRescheduleDigestText(
            normalizedCancellationDigestText(String(message.text || ""), date),
            appointments,
          ),
          appointments,
          date,
        ),
        appointments,
        date,
      ),
      closeouts,
      date,
    ),
    date,
  );
  const plainText = slackTextToPlainText(rawText);
  const appointment = appointmentForSlackAlert(rawText, appointments);
  const closeout = closeoutForSlackAlert(rawText, closeouts, date);
  const text = appointment ? [
    `⚠️ ${appointment.title}: ${appointment.jobNumber}`,
    `${appointment.customerName} · ${appointment.phone} · ${appointment.appointmentTime}`,
    appointment.address,
    appointment.items.length ? `Items: ${appointment.items.join("; ")}` : "",
    appointment.nextAction ? `Next: ${appointment.nextAction}` : "",
  ].filter(Boolean).join("\n") : closeout ? [
    "✅ Job Closed",
    `Job: ${closeout.jobNumber}`,
    ...closeout.lines,
  ].join("\n") : plainText;
  const epochMs = Number(ts) * 1_000;
  if (!ts || !text || !Number.isFinite(epochMs)) return null;

  return {
    id: `${channelId}:${ts}`,
    timestamp: new Date(epochMs).toISOString(),
    channel: slackDigestChannelName(channelId),
    rawText,
    text,
    threadReply: Boolean(message.thread_ts && message.thread_ts !== ts),
    opsCenterHref: opsCenterHref(rawText),
    appointment,
    closeout,
  };
}

async function slackGet(
  method: string,
  params: Record<string, string>,
  token: string,
  fetchImpl: typeof fetch,
): Promise<SlackHistoryResponse> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [name, value] of Object.entries(params)) {
    if (value) url.searchParams.set(name, value);
  }
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    return await response.json().catch(() => ({ ok: false, error: `http_${response.status}` })) as SlackHistoryResponse;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Slack request failed" };
  }
}

async function channelMessages(
  channelId: string,
  oldest: string,
  latest: string,
  token: string,
  fetchImpl: typeof fetch,
  appointments: Map<string, AddOnAppointment>,
  closeouts: Map<string, AnyRecord>,
  date: string,
): Promise<{ ok: boolean; messages: SlackDigestMessage[]; rateLimited: boolean }> {
  const roots: SlackMessagePayload[] = [];
  let cursor = "";

  do {
    const response = await slackGet("conversations.history", {
      channel: channelId,
      oldest,
      latest,
      inclusive: "true",
      limit: "200",
      cursor,
    }, token, fetchImpl);
    if (!response.ok) return { ok: false, messages: [], rateLimited: response.error === "ratelimited" };
    roots.push(...(response.messages || []));
    cursor = String(response.response_metadata?.next_cursor || "").trim();
  } while (cursor);

  const messages = roots.flatMap((message) => {
    const item = digestMessage(channelId, message, appointments, closeouts, date);
    return item ? [item] : [];
  });

  for (const root of roots) {
    if (!root.ts || !Number(root.reply_count || 0)) continue;
    let replyCursor = "";
    do {
      const response = await slackGet("conversations.replies", {
        channel: channelId,
        ts: root.ts,
        oldest,
        latest,
        inclusive: "true",
        limit: "200",
        cursor: replyCursor,
      }, token, fetchImpl);
      if (!response.ok) break;
      for (const reply of response.messages || []) {
        if (reply.ts === root.ts) continue;
        const item = digestMessage(channelId, reply, appointments, closeouts, date);
        if (item) messages.push(item);
      }
      replyCursor = String(response.response_metadata?.next_cursor || "").trim();
    } while (replyCursor);
  }

  return { ok: true, messages, rateLimited: false };
}

export async function fetchSlackDailyDigest(
  date: string,
  options: {
    token: string;
    channelIds: string[];
    fetchImpl?: typeof fetch;
    appointments?: AddOnAppointment[];
    completedRows?: AnyRecord[];
  },
): Promise<SlackDailyDigest> {
  const refreshedAt = new Date().toISOString();
  if (!validDate(date)) {
    return { date, messages: [], status: "unavailable", detail: "The selected date is invalid.", refreshedAt };
  }
  if (!options.token.startsWith("xoxb-")) {
    return { date, messages: [], status: "unavailable", detail: "Slack history is not configured.", refreshedAt };
  }

  const oldest = String(zonedMidnightSeconds(date));
  const latest = String(zonedMidnightSeconds(nextDate(date)) - 0.001);
  const fetchImpl = options.fetchImpl || fetch;
  let appointmentRows = options.appointments;
  if (!appointmentRows) {
    try {
      appointmentRows = [
        ...buildAddOnAppointmentFeed(date).appointments,
        ...buildCancelledAppointmentFeed(date).appointments,
      ];
    } catch {
      appointmentRows = [];
    }
  }
  const appointments = appointmentLookup(appointmentRows);
  const closeouts = closeoutLookup(options.completedRows || readCompletedJunkwareRows(date));
  const messages: SlackDigestMessage[] = [];
  let readableChannels = 0;
  let rateLimited = false;

  for (const channelId of Array.from(new Set(options.channelIds))) {
    const result = await channelMessages(
      channelId,
      oldest,
      latest,
      options.token,
      fetchImpl,
      appointments,
      closeouts,
      date,
    );
    if (result.ok) readableChannels += 1;
    if (result.rateLimited) rateLimited = true;
    messages.push(...result.messages);
  }

  const unique = Array.from(new Map(messages.map((message) => [message.id, message])).values())
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));

  if (!readableChannels) {
    return {
      date,
      messages: [],
      status: "unavailable",
      detail: rateLimited ? "Slack is temporarily rate limited." : "Slack history is temporarily unavailable.",
      refreshedAt,
    };
  }

  return { date, messages: unique, status: "ready", refreshedAt };
}

export function readSlackDailyDigest(date: string): Promise<SlackDailyDigest> {
  const cached = digestCache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = fetchSlackDailyDigest(date, {
    token: slackToken(),
    channelIds: slackDigestChannelIds(),
  });
  digestCache.set(date, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  value.catch(() => digestCache.delete(date));
  return value;
}
