import { groupSearchKingsLeadsByDate, type SearchKingsDateGroup } from "@/lib/searchkings-date-groups";
import type { SearchKingsLead } from "@/lib/searchkings";

export type SearchKingsCallRange = "latest" | "7" | "all";

export type SearchKingsCallFilter =
  | "all"
  | "quoted_lost"
  | "completed_revenue"
  | "matched_booking"
  | "qualified";

export type SearchKingsCallBrowser = {
  groups: SearchKingsDateGroup[];
  range: SearchKingsCallRange;
  filter: SearchKingsCallFilter;
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

export function normalizeSearchKingsCallFilter(value: unknown): SearchKingsCallFilter {
  return value === "quoted_lost" || value === "completed_revenue" ||
    value === "matched_booking" || value === "qualified"
    ? value
    : "all";
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

function matchesCallFilter(lead: SearchKingsLead, filter: SearchKingsCallFilter): boolean {
  switch (filter) {
    case "quoted_lost":
      return lead.status === "lost" && lead.potentialRevenue != null;
    case "completed_revenue":
      return lead.matchedAppointment?.completed === true;
    case "matched_booking":
      return lead.status === "booked" || lead.status === "recovered";
    case "qualified":
      return lead.qualified;
    default:
      return true;
  }
}

export function buildSearchKingsCallBrowser(
  leads: SearchKingsLead[],
  options: {
    range?: unknown;
    filter?: unknown;
    query?: unknown;
    page?: unknown;
    pageSize?: number;
  } = {},
): SearchKingsCallBrowser {
  const allGroups = groupSearchKingsLeadsByDate(leads);
  const range = normalizeSearchKingsCallRange(options.range);
  const rangeGroups = range === "latest"
    ? allGroups.slice(0, 1)
    : range === "7" ? allGroups.slice(0, 7) : allGroups;
  const leadsInRange = rangeGroups.flatMap((group) => group.leads);
  const filter = normalizeSearchKingsCallFilter(options.filter);
  const filteredLeads = leadsInRange.filter((lead) => matchesCallFilter(lead, filter));
  const query = String(options.query || "").trim();
  const normalizedQuery = query.toLocaleLowerCase("en-US");
  const matches = normalizedQuery
    ? filteredLeads.filter((lead) => searchableLeadText(lead).includes(normalizedQuery))
    : filteredLeads;
  const pageSize = Math.max(1, Math.min(100, Math.floor(options.pageSize || 50)));
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  const requestedPage = Math.floor(Number(options.page || 1));
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1));
  const start = (page - 1) * pageSize;
  const pageLeads = matches.slice(start, start + pageSize);

  return {
    groups: groupSearchKingsLeadsByDate(pageLeads),
    range,
    filter,
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
