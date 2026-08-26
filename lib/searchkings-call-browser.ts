import { groupSearchKingsLeadsByDate, type SearchKingsDateGroup } from "@/lib/searchkings-date-groups";
import type { SearchKingsLead } from "@/lib/searchkings";

export type SearchKingsCallRange = "latest" | "7" | "all";

export type SearchKingsCallBrowser = {
  groups: SearchKingsDateGroup[];
  range: SearchKingsCallRange;
  query: string;
  page: number;
  pageSize: number;
  totalPages: number;
  totalInRange: number;
  matchCount: number;
  firstResult: number;
  lastResult: number;
};

export function normalizeSearchKingsCallRange(value: unknown): SearchKingsCallRange {
  return value === "7" || value === "all" ? value : "latest";
}

function searchableLeadText(lead: SearchKingsLead): string {
  return [
    lead.callId,
    lead.callerName,
    lead.phone,
    lead.city,
    lead.territory,
    lead.source,
    lead.trackingLabel,
    lead.status,
    lead.summary,
    lead.matchedAppointment?.jobId,
    lead.matchedAppointment?.appointmentId,
  ].filter(Boolean).join(" ").toLocaleLowerCase("en-US");
}

export function buildSearchKingsCallBrowser(
  leads: SearchKingsLead[],
  options: { range?: unknown; query?: unknown; page?: unknown; pageSize?: number } = {},
): SearchKingsCallBrowser {
  const allGroups = groupSearchKingsLeadsByDate(leads);
  const range = normalizeSearchKingsCallRange(options.range);
  const rangeGroups = range === "latest"
    ? allGroups.slice(0, 1)
    : range === "7" ? allGroups.slice(0, 7) : allGroups;
  const leadsInRange = rangeGroups.flatMap((group) => group.leads);
  const query = String(options.query || "").trim();
  const normalizedQuery = query.toLocaleLowerCase("en-US");
  const matches = normalizedQuery
    ? leadsInRange.filter((lead) => searchableLeadText(lead).includes(normalizedQuery))
    : leadsInRange;
  const pageSize = Math.max(1, Math.min(100, Math.floor(options.pageSize || 50)));
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  const requestedPage = Math.floor(Number(options.page || 1));
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1));
  const start = (page - 1) * pageSize;
  const pageLeads = matches.slice(start, start + pageSize);

  return {
    groups: groupSearchKingsLeadsByDate(pageLeads),
    range,
    query,
    page,
    pageSize,
    totalPages,
    totalInRange: leadsInRange.length,
    matchCount: matches.length,
    firstResult: matches.length ? start + 1 : 0,
    lastResult: Math.min(start + pageSize, matches.length),
  };
}
