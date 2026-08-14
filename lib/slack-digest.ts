import { execFileSync } from "node:child_process";

const CHICAGO_TIME_ZONE = "America/Chicago";
// The client checks more frequently, while this shared cache keeps aggregate
// Slack history reads safely below the workspace method limits.
const CACHE_TTL_MS = 30_000;

const DEFAULT_CHANNEL_IDS = [
  "C0BNMDJNYV9", // ops-command
  "C0BNRMD25AS", // ops-dispatch
  "C0BNQ6J7LER", // ops-fleet
  "C0BNVJR6HMX", // ops-finance
  "C0BNXBK8GTW", // ops-growth
  "C0BPN1FVCDN", // ops-data-health
  "C0BPS5MS406", // payments
  "C0BPRML654N", // jobs-no
  "C0BPQ30C8LD", // jobs-br
  "C0BPC9M5GLX", // jobs-ns
  "C0BPU3XUANN", // truck-1
  "C0BPQGBD4N9", // truck-2
  "C0BPQGARS1K", // truck-3
  "C0BQNEV0GFJ", // truck-4
  "C0BPXQJACS0", // truck-6
  "C0BPXQK9ESG", // truck-7
  "C0BPMSJ7V43", // truck-8
  "C0BPCP2B6BH", // truck-9
] as const;

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
  author: string;
  text: string;
  threadReply: boolean;
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
  return Array.from(new Set([...DEFAULT_CHANNEL_IDS, ...configured]));
}

export function slackTextToPlainText(value: string): string {
  const emoji: Record<string, string> = {
    rotating_light: "🚨",
    warning: "⚠️",
    white_check_mark: "✅",
    truck: "🚚",
    camera_with_flash: "📸",
  };

  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
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

function authorName(message: SlackMessagePayload): string {
  return String(message.bot_profile?.name || message.username || (message.user ? "Slack member" : "Slack")).trim();
}

function digestMessage(channelId: string, message: SlackMessagePayload): SlackDigestMessage | null {
  const ts = String(message.ts || "").trim();
  const text = slackTextToPlainText(String(message.text || ""));
  const epochMs = Number(ts) * 1_000;
  if (!ts || !text || !Number.isFinite(epochMs)) return null;

  return {
    id: `${channelId}:${ts}`,
    timestamp: new Date(epochMs).toISOString(),
    author: authorName(message),
    text,
    threadReply: Boolean(message.thread_ts && message.thread_ts !== ts),
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
    const item = digestMessage(channelId, message);
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
        const item = digestMessage(channelId, reply);
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
  const messages: SlackDigestMessage[] = [];
  let readableChannels = 0;
  let rateLimited = false;

  for (const channelId of Array.from(new Set(options.channelIds))) {
    const result = await channelMessages(channelId, oldest, latest, options.token, fetchImpl);
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
