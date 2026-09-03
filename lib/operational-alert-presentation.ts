import type { SlackDigestMessage } from "@/lib/slack-digest";

export type AlertWorkflowState = "active" | "in-control" | "acknowledged" | "resolved";
export type AlertFilter = "open" | "action" | "control" | "acknowledged" | "resolved" | "all";

export type EssentialFact = { label: string; value: string; href?: string };

export type OperationalAlert = {
  id: string;
  label: string;
  domain: string;
  detected: string;
  title: string;
  facts: EssentialFact[];
  owner: string;
  next: string;
  href: string;
  needsAction: boolean;
};

function messageTime(timestamp: string): string {
  if (!Number.isFinite(new Date(timestamp).getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function plainSlackText(value: string): string {
  return String(value || "")
    .replace(/<((?:https?:\/\/|tel:)[^>|]+)\|([^>]+)>/g, "$2")
    .replace(/<((?:https?:\/\/|tel:)[^>]+)>/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/:([a-z][a-z0-9_+-]*):/gi, "")
    .replace(/[⚠️❌✅🚚📸💰🗑️⛽]/gu, "")
    .trim();
}

function cleanLines(message: SlackDigestMessage): string[] {
  return String(message.rawText || message.text || "")
    .split("\n")
    .map(plainSlackText)
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter((line) => line && !/^Alert ID:/i.test(line));
}

function findLine(lines: string[], pattern: RegExp): string {
  return lines.find((line) => pattern.test(line)) || "";
}

function jobNumber(message: SlackDigestMessage, lines: string[]): string {
  if (message.appointment?.jobNumber) return message.appointment.jobNumber;
  if (message.closeout?.jobNumber) return message.closeout.jobNumber;
  return lines.join(" ").match(/\bJK\d{5,}\b/i)?.[0]?.toUpperCase() || "Operational alert";
}

function classifyAlert(message: SlackDigestMessage, lines: string[]): Pick<OperationalAlert, "label" | "domain" | "owner" | "next" | "needsAction"> {
  const text = lines.join(" ");
  const heading = lines[0] || "";
  if (/cancel/i.test(heading)) return { label: "Cancellation", domain: "Schedule", owner: "Dispatch", next: "Review the reason and reuse the open capacity.", needsAction: true };
  if (/estimate.*closed|closed.*estimate/i.test(heading)) return { label: "Estimate Closed", domain: "Schedule", owner: "Dispatch", next: "Review the estimate outcome and follow-up.", needsAction: true };
  if (/on[ -]?site|arriv/i.test(heading)) return { label: "On Site", domain: "Schedule", owner: "Dispatch", next: "Confirm the route remains on plan.", needsAction: false };
  if (/photo/i.test(heading)) {
    const needsAction = /not verified|unverified|missing|pending/i.test(text) || !/\bverified\b/i.test(text);
    return { label: "Photos Uploaded", domain: "Schedule", owner: "Dispatch", next: needsAction ? "Verify required closeout photos." : "Complete · No action required.", needsAction };
  }
  if (/closed|closeout|payment|total/i.test(text) && message.closeout) return { label: "Job Closed", domain: "Finance", owner: "Finance", next: "Verify totals, payment, and closeout evidence.", needsAction: true };
  if (/new appointment/i.test(text) || message.appointment) return { label: "New Appointment", domain: "Schedule", owner: "Dispatch", next: "Place the appointment in the live route plan.", needsAction: true };
  if (/fleet|truck/i.test(message.channel)) return { label: "Fleet Update", domain: "Fleet", owner: "Fleet", next: "Review the truck record and required response.", needsAction: true };
  return { label: "Operational Update", domain: "Command", owner: "Mission Control", next: "Review the source record and assign the next action.", needsAction: true };
}

export function factsForAlert(message: SlackDigestMessage, lines: string[]): EssentialFact[] {
  const labeledFacts = lines.flatMap((line): EssentialFact[] => {
    const match = line.match(/^(Reason|Items|Arrival|Krewe|Crew|Driver|Navigator|Truck|Labor|Load|Bedload|CC 3%|Tips|Total|Payment|Photos|Verification|Outcome|Quote|Previous|New):\s*(.+)$/i);
    return match ? [{ label: match[1], value: match[2] }] : [];
  });
  if (/photo/i.test(lines[0] || "")) {
    const count = findLine(lines, /^\d+\s+photos?\b/i);
    const verification = findLine(lines, /^(?:not verified|unverified|verified|missing|pending)\b/i);
    const truck = message.channel.match(/truck[- ](\d+)/i)?.[1];
    return [
      ...(truck && !labeledFacts.some((fact) => /^truck$/i.test(fact.label)) ? [{ label: "Truck", value: `Truck ${truck}` }] : []),
      ...(count ? [{ label: "Photos", value: count }] : []),
      ...(verification ? [{ label: "Verification", value: verification }] : []),
      ...labeledFacts,
    ];
  }
  if (/on[ -]?site|arriv/i.test(lines[0] || "")) {
    const timeIndex = lines.findIndex((line) => /^\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s*(?:CT|CDT|CST))?$/i.test(line));
    const phone = findLine(lines, /^(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/);
    const address = message.appointment?.address || findLine(lines, /\d{2,}.*\b\d{5}(?:-\d{4})?$/);
    const customer = message.appointment?.customerName || (timeIndex >= 0 ? lines[timeIndex + 1] : "");
    return [
      ...(timeIndex >= 0 ? [{ label: "Arrival", value: lines[timeIndex] }] : []),
      ...(customer && customer !== phone && customer !== address ? [{ label: "Customer", value: customer }] : []),
      ...(phone ? [{ label: "Phone", value: phone, href: `tel:${phone.replace(/[^\d+]/g, "")}` }] : []),
      ...(address ? [{ label: "Service Address", value: address, href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` }] : []),
      ...labeledFacts,
    ];
  }
  if (message.appointment) {
    return [
      { label: "Customer", value: message.appointment.customerName || "Not provided" },
      { label: "Phone", value: message.appointment.phone || "Not provided", href: message.appointment.phone ? `tel:${message.appointment.phone.replace(/[^\d+]/g, "")}` : undefined },
      { label: "Service Address", value: message.appointment.address || "Not provided", href: message.appointment.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(message.appointment.address)}` : undefined },
      { label: "Items", value: message.appointment.items?.join(", ") || "Not listed" },
      ...labeledFacts,
    ];
  }

  if (message.closeout) {
    const closeoutFacts = message.closeout.lines.map((line) => {
      const [rawLabel, ...rawValue] = plainSlackText(line).split(":");
      return {
        label: rawValue.length ? rawLabel : "Payment",
        value: (rawValue.length ? rawValue.join(":").trim() : plainSlackText(line)).replace(/\.$/, "") || "Not provided",
      };
    });
    const crew = labeledFacts.filter((fact) => /^(driver|navigator)$/i.test(fact.label));
    const remaining = labeledFacts.filter((fact) => !/^(driver|navigator)$/i.test(fact.label));
    const present = new Set(closeoutFacts.map((fact) => fact.label.toLowerCase()));
    return [
      ...(crew.length ? [{ label: "Krewe", value: crew.map((fact) => `${fact.label}: ${fact.value}`).join(" · ") }] : []),
      ...remaining.filter((fact) => !present.has(fact.label.toLowerCase())),
      ...closeoutFacts,
    ];
  }

  const phone = findLine(lines, /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
  const address = findLine(lines, /\d{2,}.*\b\d{5}(?:-\d{4})?$/i);
  const time = findLine(lines, /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i);
  const reason = findLine(lines, /^Reason:/i).replace(/^Reason:\s*/i, "");
  const ignored = new Set([phone, address, time, lines[0], jobNumber(message, lines), ...lines.filter((line) => /^(Reason|Items|Arrival|Krewe|Crew|Truck|Photos|Verification|Outcome|Quote|Previous|New):/i.test(line))]);
  const context = lines.find((line) => !ignored.has(line) && !/^#/.test(line) && !/\bJK\d{5,}\b/i.test(line));
  const appointmentNotice = /new appointment|cancellation/i.test(lines[0] || "");
  return [
    ...(time ? [{ label: "Window", value: time }] : []),
    ...(phone ? [{ label: "Phone", value: phone, href: `tel:${phone.replace(/[^\d+]/g, "")}` }] : []),
    ...(address ? [{ label: "Service Address", value: address, href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` }] : []),
    ...labeledFacts,
    ...(context && (appointmentNotice || !reason) ? [{ label: appointmentNotice ? "Customer" : "Context", value: context }] : []),
  ];
}

export function toOperationalAlert(message: SlackDigestMessage): OperationalAlert {
  const lines = cleanLines(message);
  const classification = classifyAlert(message, lines);
  const reference = jobNumber(message, lines);
  const truck = lines[0]?.match(/\bTruck\s*#?\s*\d+/i)?.[0]?.replace(/#\s*/, "")
    || (/closed|photo/i.test(lines[0] || "") ? message.channel.match(/truck[- ](\d+)/i)?.[1]?.replace(/^(\d+)$/, "Truck $1") : undefined);
  const linkedSource = message.rawText.match(/<(https?:\/\/[^>|]+|\/jobs[^>|]*)\|JK\d+>/i)?.[1];
  const linkedOpsCenter = message.rawText.match(/<(https:\/\/ops\.junk-king\.app(?:\/[^>|]*)?)\|[^>]+>/i)?.[1];
  const window = message.appointment?.appointmentTime || findLine(lines, /\b\d{1,2}:\d{2}\s*(?:AM|PM).*\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i);
  let href = message.opsCenterHref || message.appointment?.href || message.closeout?.href || linkedSource || linkedOpsCenter || (reference === "Operational alert" ? "/?commandView=monitor" : "/jobs");
  // Keep OpsCenter records inside the current authenticated app (including an
  // isolated preview); external source links are left untouched.
  try {
    const url = new URL(href);
    if (url.protocol === "https:" && url.hostname === "ops.junk-king.app") href = `${url.pathname}${url.search}${url.hash}`;
  } catch { /* App-relative links already point at the current runtime. */ }
  return {
    id: message.id,
    ...classification,
    detected: messageTime(message.timestamp),
    title: reference === "Operational alert" ? (lines[0] || "Operational Alert") : truck ? `${truck} · ${reference}` : window ? `${reference} · ${window}` : reference,
    facts: factsForAlert(message, lines),
    href,
  };
}

export function matchesAlertFilter(alert: Pick<OperationalAlert, "needsAction">, state: AlertWorkflowState, filter: AlertFilter): boolean {
  if (filter === "all") return true;
  if (filter === "open") return state !== "resolved";
  if (filter === "action") return state === "active" && alert.needsAction;
  if (filter === "control") return state === "in-control";
  return state === filter;
}
