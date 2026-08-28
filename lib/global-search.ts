import { buildFleetMapPayload } from "@/lib/fleet-map";
import { availableDates, crewRows, readMetrics, type AnyRecord } from "@/lib/opsData";
import { crewMemberHref, fleetTruckHref, jobScheduleHref } from "@/lib/related-record-links";

export type GlobalSearchResultType = "job" | "crew" | "truck";

export type GlobalSearchResult = {
  id: string;
  type: GlobalSearchResultType;
  title: string;
  subtitle: string;
  source: string;
  href: string;
  searchText: string;
};

const RECENT_JOB_DATES = 30;
const RESULTS_PER_TYPE = 5;

function text(value: unknown): string {
  const normalized = String(value ?? "").trim();
  return normalized && normalized !== "—" ? normalized : "";
}

function first(row: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = text(row?.[key]);
    if (value) return value;
  }
  return "";
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function resultScore(result: GlobalSearchResult, query: string): number {
  const title = normalized(result.title);
  const haystack = normalized(result.searchText);
  const normalizedQuery = normalized(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const truckNumberQuery = normalizedQuery.match(/^truck\s+(\d+)$/);
  if (truckNumberQuery && !haystack.includes(`truck ${truckNumberQuery[1]}`)) return -1;
  if (!tokens.length || !tokens.every((token) => haystack.includes(token))) return -1;
  if (title === normalizedQuery) return 100;
  if (title.startsWith(normalizedQuery)) return 80;
  if (title.includes(normalizedQuery)) return 60;
  return 20 + tokens.reduce((sum, token) => sum + (title.includes(token) ? 4 : 0), 0);
}

export function searchGlobalIndex(
  index: GlobalSearchResult[],
  query: string,
  perType = RESULTS_PER_TYPE,
): GlobalSearchResult[] {
  if (normalized(query).length < 2) return [];
  const counts: Record<GlobalSearchResultType, number> = { job: 0, crew: 0, truck: 0 };
  return index
    .map((result, order) => ({ result, order, score: resultScore(result, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .flatMap(({ result }) => {
      if (counts[result.type] >= perType) return [];
      counts[result.type] += 1;
      return [result];
    });
}

function jobResult(row: AnyRecord, date: string): GlobalSearchResult | null {
  const appointmentId = first(row, ["appt_id", "appointment_id"]);
  const jkNumber = first(row, ["job_id", "jk_number", "job_number"]);
  const customer = first(row, ["customer_name", "customer", "name"]);
  if (!appointmentId && !jkNumber && !customer) return null;
  const phone = first(row, ["customer_phone", "phone"]);
  const address = first(row, ["service_address", "address"]);
  const time = first(row, ["appointment_time", "time"]);
  const status = first(row, ["job_status", "appointment_status", "status"]);
  const truck = first(row, ["truck", "assigned_truck", "truck_number"]);
  const driver = first(row, ["driver_normalized_name", "driver_name", "driver"]);
  const navigator = first(row, ["navigator_normalized_name", "navigator_name", "navigator"]);
  const title = customer && jkNumber ? `${customer} · ${jkNumber}` : customer || jkNumber || `Appointment ${appointmentId}`;
  const detail = [date, time, status, truck].filter(Boolean).join(" · ");
  const routeQuery = jkNumber || customer || appointmentId;
  return {
    id: `job:${date}:${appointmentId || jkNumber || customer}`,
    type: "job",
    title,
    subtitle: detail,
    source: "JunkWare appointment",
    href: jobScheduleHref(date, routeQuery),
    searchText: [title, phone, address, status, truck, driver, navigator, appointmentId].join(" "),
  };
}

function crewResult(row: AnyRecord, date: string): GlobalSearchResult | null {
  const name = first(row, ["name", "employee_name", "employee", "crew_member"]);
  if (!name) return null;
  const truck = first(row, ["truck", "assigned_truck", "trucks"]);
  const shift = first(row, ["shift_status", "roster_status", "pay_status"]);
  return {
    id: `crew:${normalized(name)}`,
    type: "crew",
    title: name,
    subtitle: [shift, truck].filter(Boolean).join(" · ") || "Today’s Krewe",
    source: "OpsCenter Krewe snapshot",
    href: crewMemberHref(date, name),
    searchText: [name, truck, shift].join(" "),
  };
}

export function buildGlobalSearchIndex(date: string): GlobalSearchResult[] {
  const currentMetrics = readMetrics(date);
  const jobDates = availableDates().filter((candidate) => candidate <= date).slice(0, RECENT_JOB_DATES);
  const jobs = jobDates.flatMap((jobDate) => {
    const metrics = readMetrics(jobDate);
    const appointments = Array.isArray(metrics?.appointments) ? metrics.appointments : [];
    return appointments.flatMap((row: AnyRecord) => jobResult(row, jobDate) || []);
  });

  const crew = crewRows(currentMetrics).flatMap((row) => crewResult(row, date) || []);
  const fleet = buildFleetMapPayload(date);
  const trucks = (fleet?.trucks || []).map((truck) => ({
    id: `truck:${truck.truck}`,
    type: "truck" as const,
    title: truck.truck,
    subtitle: [truck.freshnessLabel, truck.driver, truck.navigator].filter((value) => text(value)).join(" · "),
    source: "Linxup fleet",
    href: fleetTruckHref(date, truck.truck),
    searchText: [truck.truck, truck.driver, truck.navigator, truck.yearMakeModel].join(" "),
  }));

  return [...trucks, ...crew, ...jobs];
}

export function buildGlobalSearchResults(query: string, date: string): GlobalSearchResult[] {
  return searchGlobalIndex(buildGlobalSearchIndex(date), query);
}
