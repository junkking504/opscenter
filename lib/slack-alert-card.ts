import type { SlackDigestMessage } from "@/lib/slack-digest";

export type SlackAlertCardKind = "new-appointment" | "cancellation" | "completed";

export type SlackAlertCardPresentation = {
  kind: SlackAlertCardKind;
  label: "New Appointment" | "Cancellation" | "Completed";
  territory: string;
  territoryTone: "new-orleans" | "jefferson" | "westbank" | "east-metro" | "northshore" | "baton-rouge" | "lafayette" | "unknown";
  jobNumber: string;
  href: string;
  timeSlot: string;
  bodyLines: string[];
};

const TERRITORY_TONES: Array<[RegExp, SlackAlertCardPresentation["territoryTone"]]> = [
  [/\b(?:east metro|new orleans east|chalmette)\b/i, "east-metro"],
  [/\bnew orleans\b/i, "new-orleans"],
  [/\bjefferson\b/i, "jefferson"],
  [/\bwest\s*bank\b/i, "westbank"],
  [/\bnorth\s*shore\b/i, "northshore"],
  [/\bbaton rouge\b/i, "baton-rouge"],
  [/\blafayette\b/i, "lafayette"],
];

export function slackAlertDisplayLines(rawText: string): string[] {
  return String(rawText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^_?Alert ID:/i.test(line));
}

function plainLine(line: string): string {
  return String(line || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>|]+\|([^>]+)>/g, "$1")
    .replace(/[<>*_~`]/g, "")
    .replace(/^:[a-z0-9_+-]+:\s*/i, "")
    .trim();
}

function bodyWithoutHeader(lines: string[], jobNumber: string, timeSlot?: string): string[] {
  let removedTitle = false;
  let removedJob = false;
  let removedTime = !timeSlot;
  return lines.filter((line) => {
    const plain = plainLine(line);
    if (!removedTitle && /^(?:New Appointment|New same-day appointment|Cancellation|Appointment cancelled|Job Closed|Estimate Closed)\b/i.test(plain)) {
      removedTitle = true;
      return false;
    }
    if (!removedJob && new RegExp(`(?:^|\\b)${jobNumber}(?:\\b|$)`, "i").test(plain)) {
      removedJob = true;
      return false;
    }
    if (!removedTime && plain === timeSlot) {
      removedTime = true;
      return false;
    }
    return true;
  });
}

function territoryTone(territory: string): SlackAlertCardPresentation["territoryTone"] {
  return TERRITORY_TONES.find(([pattern]) => pattern.test(territory))?.[1] || "unknown";
}

export function slackAlertCardPresentation(
  message: SlackDigestMessage,
): SlackAlertCardPresentation | null {
  const appointmentTitle = String(message.appointment?.title || "").toLowerCase();
  const isCancellation = appointmentTitle.includes("cancel");
  const isNewAppointment = appointmentTitle.includes("new") && appointmentTitle.includes("appointment");
  const kind: SlackAlertCardKind | null = message.closeout
    ? "completed"
    : isCancellation
      ? "cancellation"
      : isNewAppointment
        ? "new-appointment"
        : null;
  if (!kind) return null;

  const source = message.closeout || message.appointment;
  if (!source) return null;
  const territory = String(source.territory || "Unknown territory").trim() || "Unknown territory";
  const timeSlot = String(
    "appointmentTime" in source ? source.appointmentTime : "Time unavailable",
  ).trim() || "Time unavailable";
  const lines = slackAlertDisplayLines(message.rawText);

  return {
    kind,
    label: kind === "new-appointment" ? "New Appointment" : kind === "cancellation" ? "Cancellation" : "Completed",
    territory,
    territoryTone: territoryTone(territory),
    jobNumber: source.jobNumber,
    href: source.href,
    timeSlot,
    bodyLines: bodyWithoutHeader(lines, source.jobNumber, timeSlot),
  };
}
