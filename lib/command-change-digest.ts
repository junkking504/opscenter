import type { SlackDigestMessage } from "@/lib/slack-digest";

export type CommandChangeCategory = "new-job" | "exception" | "completed";

export type CommandChangeSummary = Record<CommandChangeCategory, SlackDigestMessage[]>;

const COMPLETED_PATTERN = /\b(?:job|estimate)\s+closed\b|\bclosed\s+out\b|\bresolved\b|photos?\s+(?:uploaded|verified)|receipt\s+(?:recorded|verified)|payment\s+(?:recorded|verified)/i;
const EXCEPTION_PATTERN = /\bcancell?ation\b|\bcancelled\b|\brescheduled\b|\bwarning\b|\bneeds?\s+attention\b|\bmissing\b|\bstale\b|\boffline\b|\bfailed?\b|\berror\b|\bunclosed\b|\bdiscrepanc(?:y|ies)\b|\boverdue\b|\bno\s+driver\b|\bexception\b/i;
const NEW_JOB_PATTERN = /\bnew\s+(?:same-day\s+)?appointment\b|\bnew\s+job\b/i;

function searchableMessage(message: SlackDigestMessage): string {
  return `${message.rawText}\n${message.text}`;
}

export function classifyCommandChange(message: SlackDigestMessage): CommandChangeCategory | null {
  const source = searchableMessage(message);
  if (message.appointment && NEW_JOB_PATTERN.test(source)) return "new-job";
  if (message.closeout || COMPLETED_PATTERN.test(source)) return "completed";
  if (EXCEPTION_PATTERN.test(source)) return "exception";
  return null;
}

export function summarizeCommandChanges(
  messages: SlackDigestMessage[],
  lastLookedAt: string | null,
): CommandChangeSummary {
  const baseline = lastLookedAt ? Date.parse(lastLookedAt) : Number.NEGATIVE_INFINITY;
  const summary: CommandChangeSummary = {
    "new-job": [],
    exception: [],
    completed: [],
  };

  for (const message of messages) {
    const timestamp = Date.parse(message.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= baseline) continue;
    const category = classifyCommandChange(message);
    if (category) summary[category].push(message);
  }

  return summary;
}
