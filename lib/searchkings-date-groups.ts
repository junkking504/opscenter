import type { SearchKingsLead } from "@/lib/searchkings";

const CENTRAL_TIMEZONE = "America/Chicago";
const UNKNOWN_DATE_KEY = "unknown";

export type SearchKingsDateGroup = {
  dateKey: string;
  label: string;
  leads: SearchKingsLead[];
};

function centralDateKey(value: string): string {
  if (!value) return UNKNOWN_DATE_KEY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return UNKNOWN_DATE_KEY;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CENTRAL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatSearchKingsDateHeading(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "Unknown date";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function groupSearchKingsLeadsByDate(leads: SearchKingsLead[]): SearchKingsDateGroup[] {
  const grouped = new Map<string, SearchKingsLead[]>();

  leads.forEach((lead) => {
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(lead.calledDate)
      ? lead.calledDate
      : centralDateKey(lead.calledAt);
    const dateLeads = grouped.get(dateKey);
    if (dateLeads) dateLeads.push(lead);
    else grouped.set(dateKey, [lead]);
  });

  return Array.from(grouped, ([dateKey, dateLeads]) => ({
    dateKey,
    label: formatSearchKingsDateHeading(dateKey),
    leads: dateLeads,
  })).sort((left, right) => {
    if (left.dateKey === UNKNOWN_DATE_KEY) return 1;
    if (right.dateKey === UNKNOWN_DATE_KEY) return -1;
    return right.dateKey.localeCompare(left.dateKey);
  });
}
