/* eslint-disable @next/next/no-img-element -- JunkWare job photos are public closeout media URLs. */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import PageHeader from "@/components/PageHeader";
import OpsMonthSelector from "@/components/OpsMonthSelector";
import JobCallAheadCard from "@/components/JobCallAheadCard";
import JobCloseoutEditor from "@/components/JobCloseoutEditor";
import { JobsMap, type JobsMapPoint } from "@/components/JobsMap";
import { AnyRecord, availableDates, completedJobs, money, readMetrics, resolveDate } from "@/lib/opsData";
import { buildOperationalExceptions } from "@/lib/operational-exceptions";
import { buildFleetMapPayload, type FleetTruckMapRecord } from "@/lib/fleet-map";
import { buildMonthlyRange, monthOptions, readMonthlyAuthority } from "@/lib/monthly-summary";
import { readJobRouteAssignmentOverrides } from "@/lib/job-route-assignments";
import { jobRouteAssignmentKey } from "@/lib/job-route-key";
import { jobCallAheadLookupKey, readJobCallAheadStatuses } from "@/lib/job-call-ahead";
import {
  appointmentNotes,
  junkItemKeywords,
  junkwareJobPhotos,
  junkwarePhotoAuditAvailable,
  readJunkwareDayActivity,
  type JunkwareJobPhoto,
} from "@/lib/junkware-job-details";
import { addDays, chicagoDateKey } from "@/lib/report-dates";

const OPSBOT_DATA_DIR =
  process.env.OPSBOT_DATA_DIR ||
  path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data");

type JobRow = {
  appointmentId: string;
  sourceDate: string;
  jkNumber: string;
  appointmentUrl: string;
  appointmentTime: string;
  appointmentStartMinutes: number | null;
  appointmentEndMinutes: number | null;
  hasScheduledTime: boolean;
  customerName: string;
  customerEmail: string;
  customerEmailCollected: boolean;
  phone: string;
  address: string;
  territory: string;
  appointmentType: string;
  status: string;
  truck: string;
  assignedTruck?: string;
  driver: string;
  driverName?: string;
  driverNormalizedName?: string;
  navigator: string;
  navigatorName?: string;
  navigatorNormalizedName?: string;
  additionalCrew?: string[];
  crewAssignmentSource?: string;
  crewAssignmentStatus?: string;
  paymentType: string;
  paymentAmount: number;
  tipAmount: number;
  closeout: JobCloseout | null;
  photos: JunkwareJobPhoto[];
  photoAuditAvailable: boolean;
  junkItems: string[];
  appointmentNotes: string[];
};

type JobCloseoutCharge = {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

type JobCloseoutPayment = {
  method: string;
  detail: string;
  amount: number;
};

type JobCloseout = {
  loadQuantity: number;
  loadSize: string;
  loadPrice: number;
  bedloadQuantity: number;
  bedloadSize: string;
  bedloadPrice: number;
  otherCharges: JobCloseoutCharge[];
  discount: number;
  tip: number;
  total: number;
  payments: JobCloseoutPayment[];
  balance: number;
};

type SiteTimeTruck = {
  truck: string;
  arrival: string | null;
  departure: string | null;
  onsiteMinutes: number;
  totalTruckMinutes?: number;
  elapsedSiteCoverageMinutes?: number;
  visitCount: number;
  assignmentMismatch: boolean;
  gpsCoverageQuality: string;
  matchConfidence: string;
  matchReason: string;
  state: string;
  intervals: Array<{ arrival: string | null; departure: string | null; onsiteMinutes: number }>;
};

type SiteTimeAppointment = {
  appointmentId: string;
  jkNumber: string;
  trucks: SiteTimeTruck[];
};

type JobStatusBucket = "Open / Scheduled" | "Estimate" | "Completed" | "Canceled" | "Unclosed or Needs Attention";
type JobsView = "daily" | "calendar" | "monthly";
type JobsWorkspace = "dispatch";

type JobsFilters = {
  territory: string;
  status: string;
  paymentType: string;
  truck: string;
  q: string;
  siteTime: string;
};

type RouteLocation = {
  latitude: number;
  longitude: number;
};

type RoutePlanStop = {
  job: JobRow;
  location: RouteLocation | null;
  distanceFromPreviousMiles: number | null;
  bufferFromPreviousMinutes: number | null;
  travelAllowanceMinutes: number | null;
  warning: string | null;
};

type TruckRoutePlan = {
  truck: string;
  stops: RoutePlanStop[];
  directionsUrl: string;
  warningCount: number;
};

type JobsRoutePlan = {
  planningJobs: JobRow[];
  assignedJobs: number;
  locatedJobs: number;
  unassignedJobs: JobRow[];
  routes: TruckRoutePlan[];
};

const TERRITORY_ORDER = ["New Orleans", "Jefferson Parish", "Northshore", "Baton Rouge", "Unknown territory"];
const STATUS_ORDER: JobStatusBucket[] = [
  "Open / Scheduled",
  "Estimate",
  "Completed",
  "Canceled",
  "Unclosed or Needs Attention",
];

function siteTimeState(row: Record<string, any>): string {
  const reason = String(row?.match_reason || "");
  if (reason === "missing_effective_tracker_mapping") return "Truck not mapped to Linxup";
  if (reason === "missing_or_ambiguous_geocode") return "Appointment location could not be matched";
  if (reason === "no_physical_truck_assignment") return "Truck tracker unavailable";
  if (row?.assignment_mismatch_flag) return "Assignment mismatch";
  if (row?.match_confidence === "no_visit_detected") {
    return row?.gps_coverage_quality === "good"
      ? "No GPS visit detected"
      : "Truck tracker unavailable";
  }
  if (row?.match_confidence === "ambiguous") return "Inconclusive GPS coverage";
  return row?.match_confidence === "confirmed" ? "Confirmed visit" : "Probable visit";
}

function readAppointmentSiteTime(date: string): SiteTimeAppointment[] {
  const file = path.join(
    OPSBOT_DATA_DIR,
    "history",
    "linxup",
    "appointment_visits",
    `linxup_appointment_visits_${date}.json`,
  );
  if (!fs.existsSync(file)) return [];

  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const groups = new Map<string, Record<string, any>[]>();
    for (const row of Array.isArray(payload?.visits) ? payload.visits : []) {
      const appointmentId = String(row?.appointment_id || "").trim();
      if (!appointmentId) continue;
      if (!groups.has(appointmentId)) groups.set(appointmentId, []);
      groups.get(appointmentId)!.push(row);
    }

    return Array.from(groups.entries()).map(([appointmentId, rows]) => {
      const representative = rows[0] || {};
      return {
        appointmentId,
        jkNumber: String(representative?.jk_number || "—"),
        trucks: rows.map((row) => ({
          truck: String(row?.truck_number || "Unassigned truck"),
          arrival: row?.first_arrival || null,
          departure: row?.final_departure || null,
          onsiteMinutes: Number(row?.onsite_minutes || 0),
          totalTruckMinutes: Number(row?.total_truck_minutes || 0),
          elapsedSiteCoverageMinutes: Number(row?.elapsed_site_coverage_minutes || 0),
          visitCount: Number(row?.visit_count || 0),
          assignmentMismatch: Boolean(row?.assignment_mismatch_flag),
          gpsCoverageQuality: String(row?.gps_coverage_quality || "unknown"),
          matchConfidence: String(row?.match_confidence || ""),
          matchReason: String(row?.match_reason || ""),
          state: siteTimeState(row),
          intervals: (Array.isArray(row?.visit_intervals) ? row.visit_intervals : []).map((interval: Record<string, any>) => ({
            arrival: interval?.arrival || null,
            departure: interval?.departure || null,
            onsiteMinutes: Number(interval?.onsite_minutes || 0),
          })),
        })),
      };
    });
  } catch {
    return [];
  }
}

function siteTimeClock(value: string | null): string {
  if (!value) return "—";
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(stamp);
}

function siteDurationLabel(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes) || minutes <= 0) return "—";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours <= 0) return `${remainder} min`;
  return remainder > 0 ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function siteTimeVisitedTrucks(siteTime: SiteTimeAppointment | undefined): string[] {
  if (!siteTime) return [];
  return Array.from(new Set(siteTime.trucks
    .filter((truck) => truck.visitCount > 0 && Boolean(truck.arrival || truck.intervals.some((interval) => interval.arrival)))
    .map((truck) => truck.truck)
    .filter(Boolean)));
}

function appointmentVisitedButNotClosed(job: JobRow, visitedTrucks: string[]): boolean {
  const bucket = statusBucket(job);
  return bucket !== "Completed"
    && bucket !== "Estimate"
    && bucket !== "Canceled"
    && visitedTrucks.length > 0;
}

function gpsVisitedTrucks(job: JobRow, trucks: FleetTruckMapRecord[]): string[] {
  const location = planningLocation(job.address, readPlanningGeocodes());
  if (!location) return [];
  const minimumStopMs = 2 * 60_000;
  const maximumDistanceMiles = 125 / 1609.344;
  return trucks
    .filter((truck) => truck.gpsStops.some((stop) => {
      const begin = Date.parse(stop.begin);
      const end = Date.parse(stop.end);
      return Number.isFinite(begin)
        && Number.isFinite(end)
        && end - begin >= minimumStopMs
        && routeDistanceMiles(location, stop) <= maximumDistanceMiles;
    }))
    .map((truck) => truck.truck);
}

type AppointmentPunctuality = {
  label: string;
  tone: "early" | "on-time" | "late";
};

function chicagoClockMinutes(value: string): number | null {
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(stamp);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

function appointmentPunctuality(job: JobRow, siteTime?: SiteTimeAppointment): AppointmentPunctuality | null {
  if (job.appointmentStartMinutes == null || !siteTime?.trucks?.length) return null;
  const confirmedArrivals = siteTime.trucks
    .filter((truck) => truck.state === "Confirmed visit" && truck.arrival)
    .map((truck) => chicagoClockMinutes(String(truck.arrival)))
    .filter((minutes): minutes is number => minutes != null);
  if (!confirmedArrivals.length) return null;

  const arrival = Math.min(...confirmedArrivals);
  const start = job.appointmentStartMinutes;
  const end = job.appointmentEndMinutes ?? start + 60;
  if (arrival < start) {
    return { label: `Early · ${start - arrival} min`, tone: "early" };
  }
  if (arrival <= end) {
    return { label: `On time · ${arrival - start} min into window`, tone: "on-time" };
  }
  return { label: `Late · ${arrival - end} min`, tone: "late" };
}

function siteDurationClass(minutes: number | null | undefined): string {
  return minutes != null && Number(minutes) > 60 ? " over-hour" : "";
}

function parseClockMinutes(value: string): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const normalized = raw.replace(/\s+/g, " ").toUpperCase();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridian = match[3]?.toUpperCase() || "";

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute >= 60) return null;

  if (meridian === "AM" || meridian === "PM") {
    if (hour < 1 || hour > 12) return null;
    if (meridian === "AM") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return hour * 60 + minute;
  }

  if (hour > 23) return null;
  return hour * 60 + minute;
}

function formatClockMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

function parseAppointmentWindowRow(row: Record<string, string>): {
  display: string;
  startMinutes: number | null;
  endMinutes: number | null;
  hasScheduledTime: boolean;
} {
  const startFields = [
    "appointment_start_time",
    "appt_start_time",
    "scheduled_start_time",
    "schedule_start_time",
    "start_time",
    "start",
    "arrival_window_start",
    "window_start",
    "time_start",
  ];
  const endFields = [
    "appointment_end_time",
    "appt_end_time",
    "scheduled_end_time",
    "schedule_end_time",
    "end_time",
    "end",
    "arrival_window_end",
    "window_end",
    "time_end",
  ];
  const windowFields = [
    "appointment_time",
    "appt_time",
    "scheduled_time",
    "schedule_time",
    "time_window",
    "schedule_window",
    "arrival_window",
    "window",
    "time_slot",
    "timeslot",
  ];

  const startRaw = firstValue(row, startFields);
  const endRaw = firstValue(row, endFields);

  const startMinutes = parseClockMinutes(startRaw);
  const endMinutes = parseClockMinutes(endRaw);
  if (startMinutes !== null || endMinutes !== null) {
    const displayStart = formatClockMinutes(startMinutes);
    const displayEnd = formatClockMinutes(endMinutes);
    const display = startMinutes !== null && endMinutes !== null
      ? `${displayStart}–${displayEnd}`
      : startMinutes !== null
        ? displayStart
        : displayEnd;
    return {
      display,
      startMinutes,
      endMinutes,
      hasScheduledTime: startMinutes !== null,
    };
  }

  const raw = firstValue(row, windowFields);
  if (!raw) {
    return {
      display: "Time unavailable",
      startMinutes: null,
      endMinutes: null,
      hasScheduledTime: false,
    };
  }

  const normalized = String(raw).replace(/\s+/g, " ").trim();
  const rangeMatch = normalized.match(
    /^(.+?)\s*(?:-|–|—|to)\s*(.+)$/i,
  );
  if (rangeMatch) {
    const left = rangeMatch[1].trim();
    const right = rangeMatch[2].trim();
    const rightMeridian = right.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase() || "";
    const leftMeridian = left.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase() || rightMeridian;

    const leftValue = parseClockMinutes(leftMeridian && !/\b(AM|PM)\b/i.test(left) ? `${left} ${leftMeridian}` : left);
    const rightValue = parseClockMinutes(right);
    const displayLeft = formatClockMinutes(leftValue);
    const displayRight = formatClockMinutes(rightValue ?? (rightMeridian && !/\b(AM|PM)\b/i.test(right) ? parseClockMinutes(`${right} ${rightMeridian}`) : null));

    if (leftValue !== null || rightValue !== null) {
      return {
        display: leftValue !== null && rightValue !== null ? `${displayLeft}–${displayRight}` : leftValue !== null ? displayLeft : displayRight,
        startMinutes: leftValue,
        endMinutes: rightValue,
        hasScheduledTime: leftValue !== null,
      };
    }
  }

  const singleValue = parseClockMinutes(normalized);
  if (singleValue !== null) {
    return {
      display: formatClockMinutes(singleValue),
      startMinutes: singleValue,
      endMinutes: null,
      hasScheduledTime: true,
    };
  }

  return {
    display: normalized,
    startMinutes: null,
    endMinutes: null,
    hasScheduledTime: false,
  };
}

function compareJobSchedule(a: JobRow, b: JobRow): number {
  const aTimed = a.hasScheduledTime || a.appointmentStartMinutes !== null;
  const bTimed = b.hasScheduledTime || b.appointmentStartMinutes !== null;
  if (aTimed !== bTimed) return aTimed ? -1 : 1;

  if (aTimed && bTimed) {
    const startA = a.appointmentStartMinutes ?? Number.MAX_SAFE_INTEGER;
    const startB = b.appointmentStartMinutes ?? Number.MAX_SAFE_INTEGER;
    if (startA !== startB) return startA - startB;

    const endA = a.appointmentEndMinutes ?? Number.MAX_SAFE_INTEGER;
    const endB = b.appointmentEndMinutes ?? Number.MAX_SAFE_INTEGER;
    if (endA !== endB) return endA - endB;
  }

  const jkCompare = a.jkNumber.localeCompare(b.jkNumber, undefined, { numeric: true, sensitivity: "base" });
  if (jkCompare !== 0) return jkCompare;
  return a.customerName.localeCompare(b.customerName, undefined, { sensitivity: "base" });
}

function normalizeAddressLine(row: Record<string, string>): string {
  const street = firstValue(row, [
    "street_address",
    "address",
    "service_address",
    "job_address",
    "customer_address",
    "Address",
    "Service Address",
    "Customer Address",
  ]);
  const city = firstValue(row, ["city", "City"]);
  const state = firstValue(row, ["state", "State"]);
  const zip = firstValue(row, ["zip", "zipcode", "postal_code", "Zip", "ZIP"]);

  const cityState = [city, state ? [state, zip].filter(Boolean).join(" ") : zip].filter(Boolean).join(", ");
  const parts = [street, cityState].filter(Boolean);

  if (!parts.length) return "Address unavailable";
  return parts.join(", ");
}

function siteTimeTruckDurationMinutes(truck: Record<string, any>): number | null {
  const direct = Number(truck?.onsiteMinutes ?? truck?.onsite_minutes ?? NaN);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const intervalMinutes = Array.isArray(truck?.intervals)
    ? truck.intervals.reduce((sum: number, interval: Record<string, any>) => {
        const minutes = Number(interval?.onsiteMinutes ?? interval?.onsite_minutes ?? 0);
        return Number.isFinite(minutes) && minutes > 0 ? sum + minutes : sum;
      }, 0)
    : 0;
  if (intervalMinutes > 0) return intervalMinutes;

  const visitCount = Number(truck?.visitCount ?? truck?.visit_count ?? 0);
  const visitState = String(truck?.state || "").trim().toLowerCase();
  const hasTruckVisit =
    (Number.isFinite(visitCount) && visitCount > 0) ||
    visitState === "confirmed visit" ||
    visitState === "probable visit";
  if (!hasTruckVisit) return null;

  const coverage = Number(
    truck?.totalTruckMinutes ??
      truck?.total_truck_minutes ??
      truck?.elapsedSiteCoverageMinutes ??
      truck?.elapsed_site_coverage_minutes ??
      0,
  );
  if (Number.isFinite(coverage) && coverage > 0) return coverage;

  return null;
}

function siteTimeQuality(row: Record<string, any>): string {
  const reason = String(row?.matchReason ?? row?.match_reason ?? "").trim();
  const confidence = String(row?.matchConfidence ?? row?.match_confidence ?? "").trim().toLowerCase();
  const firstArrival = row?.arrival ?? row?.first_arrival;
  const finalDeparture = row?.departure ?? row?.final_departure;
  const visitCount = Number(row?.visitCount ?? row?.visit_count ?? 0);
  const gpsCoverageQuality = String(row?.gpsCoverageQuality ?? row?.gps_coverage_quality ?? "unknown");

  if (reason === "missing_effective_tracker_mapping" || reason === "no_physical_truck_assignment") {
    return "Truck assignment unavailable";
  }
  if (reason === "missing_or_ambiguous_geocode") {
    return "Address could not be geocoded";
  }
  if (firstArrival && !finalDeparture) {
    return "Arrival detected; departure unavailable";
  }
  if (confidence === "confirmed" || confidence === "probable") {
    return visitCount > 0 ? "Verified truck visit" : "No verified truck visit";
  }
  if (confidence === "ambiguous") {
    return gpsCoverageQuality === "good" ? "Possible match — review required" : "GPS data unavailable";
  }
  if (confidence === "no_visit_detected") {
    return gpsCoverageQuality === "good" ? "No verified truck visit" : "GPS data unavailable";
  }
  return "Possible match — review required";
}

function siteTimeVisitLabel(row: Record<string, any>): string {
  if (row?.first_arrival && row?.final_departure) {
    return `${siteTimeClock(String(row.first_arrival))}–${siteTimeClock(String(row.final_departure))}`;
  }
  if (row?.first_arrival && !row?.final_departure) {
    return `On Site`;
  }
  return siteTimeQuality(row);
}

function siteTimeDurationMinutes(row: Record<string, any>): number | null {
  if (row?.onsite_minutes == null || Number.isNaN(Number(row.onsite_minutes))) return null;
  const minutes = Number(row.onsite_minutes);
  return minutes > 0 ? minutes : null;
}

function siteTimeLookupKeys(job: JobRow): string[] {
  return [job.appointmentId, job.jkNumber]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
}

function normalizeJobsView(value: unknown): JobsView {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "calendar") return "calendar";
  if (normalized === "monthly") return "monthly";
  return "daily";
}

function normalizeJobsWorkspace(value: unknown): JobsWorkspace {
  // Schedule, map, and the former route-planning view now share one Dispatch workspace.
  // Keep accepting legacy workspace values so saved links land in the combined view.
  void value;
  return "dispatch";
}

function buildJobsHref({
  date,
  view,
  workspace,
  territory,
  status,
  paymentType,
  truck,
  q,
  siteTime,
}: {
  date: string;
  view: JobsView;
  workspace?: JobsWorkspace;
  territory?: string;
  status?: string;
  paymentType?: string;
  truck?: string;
  q?: string;
  siteTime?: string;
}) {
  const params = new URLSearchParams();
  params.set("date", date);
  if (view !== "daily") params.set("view", view);
  if (view === "daily" && workspace && workspace !== "dispatch") params.set("workspace", workspace);
  if (territory) params.set("territory", territory);
  if (status) params.set("status", status);
  if (paymentType) params.set("paymentType", paymentType);
  if (truck) params.set("truck", truck);
  if (q) params.set("q", q);
  if (siteTime) params.set("siteTime", siteTime);
  return `/jobs?${params.toString()}`;
}

function ScheduleDayToggle({
  date,
  workspace,
  filters,
}: {
  date: string;
  workspace: JobsWorkspace;
  filters: JobsFilters;
}) {
  const today = chicagoDateKey();
  const tomorrow = addDays(today, 1);

  return (
    <div className="ops-view-toggle" aria-label="Schedule day">
      <Link
        href={buildJobsHref({ date: today, view: "daily", workspace, ...filters })}
        className={date === today ? "active" : ""}
      >
        Today
      </Link>
      <Link
        href={buildJobsHref({ date: tomorrow, view: "daily", workspace, ...filters })}
        className={date === tomorrow ? "active" : ""}
      >
        Tomorrow
      </Link>
    </div>
  );
}

function scheduleDayCopy(date: string) {
  const today = chicagoDateKey();
  if (date === today) {
    return {
      possessive: "Today’s",
      subtitle: "Today’s schedule. Start with Needs attention, then review upcoming appointments.",
    };
  }
  if (date === addDays(today, 1)) {
    return {
      possessive: "Tomorrow’s",
      subtitle: "Tomorrow’s schedule preview. Review appointments, crew assignments, and dispatch routes ahead of time.",
    };
  }

  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
  return {
    possessive: `${formatted}’s`,
    subtitle: `Schedule for ${formatted}. Review appointments, assignments, and route details.`,
  };
}

function monthPrefixForDate(date: string): string {
  return date.slice(0, 7);
}

function availableJobDates(): string[] {
  const found = new Set<string>();
  for (const dir of junkwareDirs()) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        const match = file.match(/^junkware_(?:live_|completed_)?(\d{4}-\d{2}-\d{2})(?:_summary\.csv|_raw\.json)$/);
        if (match) found.add(match[1]);
      }
    } catch {}
  }
  return Array.from(found).sort((a, b) => a.localeCompare(b));
}

function monthDatesFor(date: string): string[] {
  const prefix = monthPrefixForDate(date);
  return Array.from(new Set([...availableDates(), ...availableJobDates()]))
    .filter((value) => value.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b));
}

function jobsMonthOptions() {
  const byMonth = new Map(monthOptions().map((month) => [month.key, month]));
  for (const date of availableJobDates()) {
    const key = monthPrefixForDate(date);
    if (byMonth.has(key)) continue;
    byMonth.set(key, {
      key,
      date: `${key}-01`,
      label: new Date(`${key}-01T12:00:00Z`).toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "long",
        year: "numeric",
      }),
    });
  }
  return Array.from(byMonth.values()).sort((a, b) => b.key.localeCompare(a.key));
}

function jobKey(job: JobRow): string {
  const appointmentId = String(job.appointmentId || "").trim();
  if (appointmentId) return `appt:${appointmentId}`;
  const jk = String(job.jkNumber || "").trim().toLowerCase();
  if (jk && jk !== "—") return `job:${jk}`;
  return [
    job.customerName,
    job.appointmentTime,
    job.address,
    job.territory,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
}

function appointmentCardId(job: JobRow): string {
  const jkNumber = String(job.jkNumber || "").trim();
  const reference = jkNumber && jkNumber !== "—"
    ? jkNumber
    : String(job.appointmentId || jobKey(job));
  return `job-${reference.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`;
}

function jobStatusRank(job: JobRow): number {
  const bucket = statusBucket(job);
  switch (bucket) {
    case "Completed":
      return 4;
    case "Estimate":
      return 3;
    case "Open / Scheduled":
      return 2;
    case "Unclosed or Needs Attention":
      return 1;
    case "Canceled":
      return 0;
  }
}

function buildMonthlyJobsSummary(selectedDate: string) {
  const monthDates = monthDatesFor(selectedDate);
  const jobsByDate = new Map<string, JobRow[]>();
  const finalJobs = new Map<
    string,
    {
      job: JobRow;
      originalType: string;
      originalStatus: string;
      firstDate: string;
    }
  >();
  const siteTimeByKey = new Map<string, SiteTimeAppointment>();
  const dailyTrend = new Map<string, { revenue: number; jobs: number }>();

  for (const date of monthDates) {
    for (const appointment of readAppointmentSiteTime(date)) {
      for (const key of [appointment.appointmentId, appointment.jkNumber]) {
        const normalized = String(key || "").trim().toLowerCase();
        if (normalized) siteTimeByKey.set(normalized, appointment);
      }
    }

    const metrics = readMetrics(date);
    dailyTrend.set(date, {
      revenue: Number(metrics?.total_revenue || metrics?.gross_revenue || 0) || 0,
      jobs: completedJobs(metrics),
    });

    const dayJobs = applyJobRouteAssignmentOverrides(readJobRows(date), date);
    jobsByDate.set(date, dayJobs);
    for (const job of dayJobs) {
      const key = jobKey(job);
      const existing = finalJobs.get(key);
      if (!existing) {
        finalJobs.set(key, {
          job,
          originalType: job.appointmentType,
          originalStatus: job.status,
          firstDate: date,
        });
        continue;
      }

      if (
        jobStatusRank(job) > jobStatusRank(existing.job) ||
        (jobStatusRank(job) === jobStatusRank(existing.job) && date.localeCompare(existing.firstDate) >= 0)
      ) {
        existing.job = job;
      }
    }
  }

  const jobs = Array.from(finalJobs.values()).map((entry) => entry.job);
  const completedRows = jobs.filter((job) => statusBucket(job) === "Completed");
  const estimateRows = jobs.filter((job) => statusBucket(job) === "Estimate");
  const canceledRows = jobs.filter((job) => statusBucket(job) === "Canceled");
  const unclosedRows = jobs.filter((job) => statusBucket(job) === "Unclosed or Needs Attention");
  const openRows = jobs.filter((job) => statusBucket(job) === "Open / Scheduled");
  const revenueByTerritory = new Map<string, number>();
  const jobsByTerritory = new Map<string, number>();
  const revenueByPaymentType = new Map<string, number>();
  const jobsByPaymentType = new Map<string, number>();
  const siteTimeByTerritory = new Map<string, number>();
  const siteTimeByPaymentType = new Map<string, number>();

  let totalRevenue = 0;
  let totalTips = 0;
  let tippedJobs = 0;
  let estimatedToJobConversions = 0;
  let eligibleEstimateAppointments = 0;
  let totalSiteMinutes = 0;
  let completedSiteMinutes = 0;
  const siteTimePerCompletedJob: number[] = [];
  const siteTimeByTruck = new Map<string, number>();

  for (const entry of finalJobs.values()) {
    const job = entry.job;
    const bucket = statusBucket(job);
    const territory = normalizeTerritory(job.territory);
    const paymentType = safeText(job.paymentType);
    const key = jobKey(job);
    const siteTime = siteTimeByKey.get(key) || siteTimeByKey.get(String(job.appointmentId || "").trim().toLowerCase()) || siteTimeByKey.get(String(job.jkNumber || "").trim().toLowerCase()) || null;
    const siteMinutes = siteTime
      ? siteTime.trucks.reduce((sum, truck) => sum + Number(siteTimeTruckDurationMinutes(truck) || 0), 0)
      : 0;
    const isCompleted = bucket === "Completed";

    if (isCompleted) {
      revenueByTerritory.set(territory, (revenueByTerritory.get(territory) || 0) + Number(job.paymentAmount || 0));
      jobsByTerritory.set(territory, (jobsByTerritory.get(territory) || 0) + 1);
      revenueByPaymentType.set(paymentType, (revenueByPaymentType.get(paymentType) || 0) + Number(job.paymentAmount || 0));
      jobsByPaymentType.set(paymentType, (jobsByPaymentType.get(paymentType) || 0) + 1);
      totalRevenue += Number(job.paymentAmount || 0);
      totalTips += Number(job.tipAmount || 0);
      if (Number(job.tipAmount || 0) > 0) tippedJobs += 1;
      totalSiteMinutes += siteMinutes;
      siteTimePerCompletedJob.push(siteMinutes);
      completedSiteMinutes += siteMinutes;
      siteTimeByTerritory.set(territory, (siteTimeByTerritory.get(territory) || 0) + siteMinutes);
      siteTimeByPaymentType.set(paymentType, (siteTimeByPaymentType.get(paymentType) || 0) + siteMinutes);
      if (job.truck) {
        siteTimeByTruck.set(job.truck, (siteTimeByTruck.get(job.truck) || 0) + siteMinutes);
      }
    }

    if (entry.originalType.toLowerCase().includes("estimate")) eligibleEstimateAppointments += 1;
    if (entry.originalType.toLowerCase().includes("estimate") && isCompleted) estimatedToJobConversions += 1;
  }

  const completedJobsCount = completedRows.length;
  const averageJobSize = completedJobsCount > 0 ? totalRevenue / completedJobsCount : 0;
  const estimateCloseRate = eligibleEstimateAppointments > 0 ? estimatedToJobConversions / eligibleEstimateAppointments : null;
  const tippedJobRate = completedJobsCount > 0 ? tippedJobs / completedJobsCount : null;
  const averageTipPerTippedJob = tippedJobs > 0 ? totalTips / tippedJobs : null;
  const jobsOverOneHour = siteTimePerCompletedJob.filter((value) => value > 60).length;
  const percentJobsOverOneHour = completedJobsCount > 0 ? jobsOverOneHour / completedJobsCount : null;
  const medianTruckSiteTime = siteTimePerCompletedJob.length
    ? [...siteTimePerCompletedJob].sort((a, b) => a - b)[Math.floor(siteTimePerCompletedJob.length / 2)]
    : null;
  const averageTruckSiteTimePerCompletedJob = completedJobsCount > 0 ? completedSiteMinutes / completedJobsCount : null;
  const monthLabel = monthPrefixForDate(selectedDate);
  const monthDisplay = new Date(`${monthPrefixForDate(selectedDate)}-01T00:00:00-05:00`).toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "long",
    year: "numeric",
  });

  return {
    monthLabel,
    monthDisplay,
    monthDates,
    jobsByDate,
    jobs,
    completedJobsCount,
    estimateRows,
    canceledRows,
    unclosedRows,
    openRows,
    totalRevenue,
    totalTips,
    averageJobSize,
    estimateCloseRate,
    estimatedToJobConversions,
    eligibleEstimateAppointments,
    tippedJobs,
    tippedJobRate,
    averageTipPerTippedJob,
    jobsOverOneHour,
    percentJobsOverOneHour,
    totalSiteMinutes,
    averageTruckSiteTimePerCompletedJob,
    medianTruckSiteTime,
    revenueByTerritory,
    jobsByTerritory,
    revenueByPaymentType,
    jobsByPaymentType,
    siteTimeByTerritory,
    siteTimeByPaymentType,
    dailyTrend,
    siteTimeByKey,
    siteTimeByTruck,
  };
}

const CALENDAR_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function calendarDays(selectedDate: string, jobsByDate: Map<string, JobRow[]>) {
  const monthKey = monthPrefixForDate(selectedDate);
  const [year, month] = monthKey.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: Array<{ date: string; dayNumber: number; jobs: JobRow[] } | null> = Array(firstWeekday).fill(null);

  for (let dayNumber = 1; dayNumber <= dayCount; dayNumber++) {
    const date = `${monthKey}-${String(dayNumber).padStart(2, "0")}`;
    days.push({
      date,
      dayNumber,
      jobs: [...(jobsByDate.get(date) || [])].sort(compareJobSchedule),
    });
  }

  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function calendarStatusClass(job: JobRow): string {
  switch (statusBucket(job)) {
    case "Completed": return "is-completed";
    case "Estimate": return "is-estimate";
    case "Canceled": return "is-canceled";
    case "Unclosed or Needs Attention": return "is-attention";
    default: return "is-scheduled";
  }
}

function calendarJobMeta(job: JobRow): string {
  const territory = normalizeTerritory(job.territory);
  const rawTruck = String(job.assignedTruck || job.truck || "").trim();
  const hasTruck = Boolean(rawTruck && rawTruck !== "—" && !/^unavailable$/i.test(rawTruck));
  return hasTruck ? `${territory} · ${rawTruck}` : territory;
}

function firstValue(row: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function moneyNumber(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const cleaned = String(value).replace(/[$,]/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

function parseJobCloseout(row: Record<string, any>): JobCloseout | null {
  let raw = row?.closeout;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const otherCharges = (Array.isArray(raw.otherCharges) ? raw.otherCharges : [])
    .map((charge: Record<string, unknown>): JobCloseoutCharge | null => {
      const name = String(charge?.name || "").trim();
      if (!name) return null;
      return {
        name,
        quantity: moneyNumber(charge.quantity),
        unitPrice: moneyNumber(charge.unitPrice),
        total: moneyNumber(charge.total),
      };
    })
    .filter((charge: JobCloseoutCharge | null): charge is JobCloseoutCharge => Boolean(charge));

  const payments = (Array.isArray(raw.payments) ? raw.payments : [])
    .map((payment: Record<string, unknown>): JobCloseoutPayment | null => {
      const method = String(payment?.method || "").trim();
      if (!method) return null;
      return {
        method,
        detail: String(payment?.detail || "").trim(),
        amount: moneyNumber(payment.amount),
      };
    })
    .filter((payment: JobCloseoutPayment | null): payment is JobCloseoutPayment => Boolean(payment));

  const closeout: JobCloseout = {
    loadQuantity: moneyNumber(raw.loadQuantity),
    loadSize: String(raw.loadSize || "").trim(),
    loadPrice: moneyNumber(raw.loadPrice),
    bedloadQuantity: moneyNumber(raw.bedloadQuantity),
    bedloadSize: String(raw.bedloadSize || "").trim(),
    bedloadPrice: moneyNumber(raw.bedloadPrice),
    otherCharges,
    discount: moneyNumber(raw.discount),
    tip: moneyNumber(raw.tip),
    total: moneyNumber(raw.total),
    payments,
    balance: moneyNumber(raw.balance),
  };

  return closeout.total > 0
    || closeout.loadPrice > 0
    || closeout.bedloadPrice > 0
    || closeout.otherCharges.length > 0
    || closeout.payments.length > 0
    ? closeout
    : null;
}

function csvSplitLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");

  if (lines.length < 2) return [];

  const headers = csvSplitLine(lines[0]).map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = csvSplitLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() || "";
    });

    return row;
  });
}

function junkwareDirs(): string[] {
  return [
    path.join(process.cwd(), "data", "history", "junkware"),
    path.join(process.cwd(), "..", "opsbot", "data", "history", "junkware"),
    path.join(
      process.env.HOME || "",
      ".openclaw",
      "workspace",
      "opsbot",
      "data",
      "history",
      "junkware"
    ),
  ];
}

function findJobsCsv(date: string): string | null {
  const candidates = [
    `junkware_completed_${date}_summary.csv`,
    `junkware_live_${date}_summary.csv`,
  ];

  for (const dir of junkwareDirs()) {
    for (const file of candidates) {
      const candidate = path.join(dir, file);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}


function buildJunkwareAppointmentUrl(row: Record<string, string>): string {
  const directUrl = firstValue(row, [
    "appointment_url",
    "appt_url",
    "job_url",
    "junkware_url",
    "source_url",
    "url",
    "Appointment URL",
    "Job URL",
    "Junkware URL",
    "URL",
  ]);

  if (directUrl && directUrl.startsWith("http")) {
    return directUrl;
  }

  const appointmentId = firstValue(row, [
    "appt_id",
    "appointment_id",
    "Appointment ID",
    "Appt ID",
  ]);

  if (appointmentId && appointmentId !== "—") {
    return `https://junkware.junk-king.com/franchise/appointment.aspx?id=${encodeURIComponent(appointmentId)}`;
  }

  return "";
}

function junkwareAppointmentId(appointmentUrl: string): string {
  const match = String(appointmentUrl || "").match(/[?&]id=(\d{1,12})(?:&|$)/i);
  return match?.[1] || "";
}


function formatPhone(value: string): string {
  const raw = String(value || "").trim();
  if (!raw || raw === "—") return "";
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  if (national.length !== 10) return raw;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

function validCustomerEmail(value: unknown): string {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function firstCustomerEmail(...rows: Record<string, string>[]): string {
  const keys = [
    "customerEmail",
    "customer_email",
    "email",
    "email_address",
    "emailAddress",
    "Email",
    "Customer Email",
  ];
  for (const row of rows) {
    for (const key of keys) {
      const email = validCustomerEmail(row?.[key]);
      if (email) return email;
    }
  }
  return "";
}

function hasCustomerEmailField(...rows: Record<string, string>[]): boolean {
  const keys = ["customerEmail", "customer_email", "email", "email_address", "emailAddress", "Email", "Customer Email"];
  return rows.some((row) => keys.some((key) => Object.prototype.hasOwnProperty.call(row || {}, key)));
}

function rawJunkwareFile(date: string): string {
  return path.join(
    OPSBOT_DATA_DIR,
    "history",
    "junkware",
    `junkware_${date}_raw.json`,
  );
}

function readRawCancelledRows(date: string): Record<string, string>[] {
  const file = rawJunkwareFile(date);
  if (!fs.existsSync(file)) return [];

  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return (Array.isArray(payload?.cancelled) ? payload.cancelled : [])
      .filter((row: unknown) => row && typeof row === "object") as Record<string, string>[];
  } catch {
    return [];
  }
}

function readRawAppointmentLookup(date: string): Map<string, Record<string, any>> {
  const file = rawJunkwareFile(date);
  const lookup = new Map<string, Record<string, any>>();
  if (!fs.existsSync(file)) return lookup;

  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const rows = [
      ...(Array.isArray(payload?.appointments) ? payload.appointments : []),
      ...(Array.isArray(payload?.completed) ? payload.completed : []),
      ...(Array.isArray(payload?.cancelled) ? payload.cancelled : []),
    ];
    for (const source of rows) {
      const row = source && typeof source === "object" ? source as Record<string, any> : {};
      const apptId = firstValue(row, ["appt_id", "appointment_id"]);
      const jobId = firstValue(row, ["job_id", "jk_number"]);
      if (apptId) lookup.set(`appt:${apptId}`, row);
      if (jobId) lookup.set(`job:${jobId.toLowerCase()}`, row);
    }
  } catch {
    return lookup;
  }
  return lookup;
}

function findAppointmentTime(row: Record<string, string>): string {
  return parseAppointmentWindowRow(row).display;
}


function normalizeJobRow(row: Record<string, string>): JobRow {
  const jkNumber =
    firstValue(row, [
      "jk_number",
      "jk",
      "job_number",
      "job_id",
      "appointment_id",
      "appointment_number",
      "confirmation_number",
      "work_order",
      "work_order_number",
      "JK Number",
      "JK",
      "Job Number",
      "Job ID",
      "Appointment ID",
      "Appointment Number",
      "Confirmation Number",
      "Work Order",
      "Work Order Number",
    ]) || "—";

  const appointmentUrl = buildJunkwareAppointmentUrl(row);

  const parsedTime = parseAppointmentWindowRow(row);
  const appointmentTime = parsedTime.display;

  const customerName =
    firstValue(row, [
      "customer_name",
      "customer",
      "name",
      "client_name",
      "contact_name",
      "Customer Name",
      "Customer",
      "Name",
    ]) || "—";

  const customerEmail = firstCustomerEmail(row) || "—";
  const customerEmailCollected = hasCustomerEmailField(row);

  const phone =
    firstValue(row, [
      "phone",
      "phone_number",
      "customer_phone",
      "client_phone",
      "contact_phone",
      "Phone",
      "Phone Number",
      "Customer Phone",
    ]) || "—";

  const address = normalizeAddressLine(row);

  const territory =
    firstValue(row, [
      "territory",
      "market",
      "franchise",
      "location",
      "Territory",
      "Market",
    ]) || "—";

  const appointmentType =
    firstValue(row, [
      "appointment_type",
      "appt_type",
      "job_type",
      "type",
      "Appointment Type",
      "Type",
    ]) || "—";

  const status =
    firstValue(row, [
      "job_status",
      "status",
      "schedule_status",
      "appointment_status",
      "appt_status",
      "Status",
      "Job Status",
    ]) || "—";

  const paymentType =
    firstValue(row, [
      "payment_type",
      "payment_method",
      "payment",
      "method",
      "Payment Type",
      "Payment Method",
    ]) || "—";

  const paymentAmount = moneyNumber(
    firstValue(row, [
      "payment_amount",
      "payments_collected",
      "amount_collected",
      "collected",
      "amount",
      "total",
      "revenue",
      "sales",
      "job_revenue",
      "gross_revenue",
      "total_revenue",
      "Payment Amount",
      "Amount",
      "Total",
      "Revenue",
    ])
  );

  return {
    appointmentId: junkwareAppointmentId(appointmentUrl),
    sourceDate: "",
    jkNumber,
    appointmentUrl,
    appointmentTime,
    appointmentStartMinutes: parsedTime.startMinutes,
    appointmentEndMinutes: parsedTime.endMinutes,
    hasScheduledTime: parsedTime.hasScheduledTime,
    customerName,
    customerEmail,
    customerEmailCollected,
    phone,
    address,
    territory,
    appointmentType,
    status,
    truck: firstValue(row, ["truck", "assigned_truck", "truck_name"]) || "—",
    assignedTruck: firstValue(row, ["assigned_truck", "truck", "truck_name"]) || "—",
    driver: firstValue(row, ["driver", "driver_name", "driver_normalized_name", "assigned_driver"]) || "—",
    driverName: firstValue(row, ["driver_name", "driver"]) || "—",
    driverNormalizedName: firstValue(row, ["driver_normalized_name", "driver_name", "driver"]) || "—",
    navigator: firstValue(row, ["navigator", "navigator_name", "navigator_normalized_name", "assigned_navigator"]) || "—",
    navigatorName: firstValue(row, ["navigator_name", "navigator"]) || "—",
    navigatorNormalizedName: firstValue(row, ["navigator_normalized_name", "navigator_name", "navigator"]) || "—",
    additionalCrew: parseCrewList(row.additional_crew),
    crewAssignmentSource: firstValue(row, ["crew_assignment_source"]) || "—",
    crewAssignmentStatus: firstValue(row, ["crew_assignment_status"]) || "—",
    paymentType,
    paymentAmount,
    tipAmount: moneyNumber(firstValue(row, ["tip", "Tip", "customer_tip", "Customer Tip"]) || "0"),
    closeout: null,
    photos: junkwareJobPhotos(row),
    photoAuditAvailable: junkwarePhotoAuditAvailable(row),
    junkItems: junkItemKeywords(row),
    appointmentNotes: appointmentNotes(row),
  };
}


function paymentClass(paymentType: string): string {
  const normalized = paymentType.toLowerCase();

  if (normalized.includes("credit") || normalized.includes("card")) {
    return "ops-payment-badge credit-card";
  }

  if (normalized.includes("cash")) {
    return "ops-payment-badge cash";
  }

  if (normalized.includes("check") || normalized.includes("cheque")) {
    return "ops-payment-badge check";
  }

  if (
    normalized.includes("bill") ||
    normalized.includes("invoice") ||
    normalized.includes("open")
  ) {
    return "ops-payment-badge billed";
  }

  return "ops-payment-badge unknown";
}


function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function readCsv(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8").trim();

  if (!raw) {
    return [];
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    return row;
  });
}

function readJobRows(date: string): JobRow[] {
  const junkwareDir = path.join(OPSBOT_DATA_DIR, "history", "junkware");

  const completedCsv = path.join(
    junkwareDir,
    `junkware_completed_${date}_summary.csv`,
  );

  const liveCsv = path.join(
    junkwareDir,
    `junkware_live_${date}_summary.csv`,
  );

  const files = [
    { path: completedCsv, source: "completed" },
    { path: liveCsv, source: "live" },
  ].filter((file) => fs.existsSync(file.path));

  const seen = new Set<string>();
  const jobs: JobRow[] = [];
  const rawAppointmentLookup = readRawAppointmentLookup(date);
  const rowSources = [
    { rows: readRawCancelledRows(date), source: "cancelled" },
    ...files.map((file) => ({ rows: readCsv(file.path), source: file.source })),
  ];

  function cleanMoneyValue(value: string): string {
    return String(value || "")
      .replace(/[$,]/g, "")
      .trim();
  }

  function jobKey(row: Record<string, string>): string {
    const apptId = firstValue(row, [
      "appt_id",
      "appointment_id",
      "Appointment ID",
      "Appt ID",
    ]);

    const jobId = firstValue(row, [
      "job_id",
      "jk_number",
      "job_number",
      "Job ID",
      "Job Number",
      "JK Number",
    ]);

    if (apptId && apptId !== "—") return `appt:${apptId}`;
    if (jobId && jobId !== "—") return `job:${jobId}`;

    return [
      firstValue(row, ["customer_name", "customer", "Customer Name", "Customer"]),
      firstValue(row, ["address", "Address"]),
      findAppointmentTime(row),
      firstValue(row, ["appointment_type", "type", "Appointment Type", "Type"]),
    ].join("|");
  }

  for (const rowSource of rowSources) {
    for (const row of rowSource.rows) {
      const key = jobKey(row);

      // Cancellation rows are authoritative and loaded first. If JunkWare
      // briefly returns the same appointment in another table, retain the
      // canceled state instead of the stale scheduled/completed state.
      if (seen.has(key)) continue;
      seen.add(key);

      const apptId = firstValue(row, ["appt_id", "appointment_id", "Appointment ID", "Appt ID"]);
      const rowJobId = firstValue(row, ["job_id", "jk_number", "job_number", "Job ID", "JK Number"]);
      const sourceRow =
        (apptId ? rawAppointmentLookup.get(`appt:${apptId}`) : undefined) ||
        (rowJobId ? rawAppointmentLookup.get(`job:${rowJobId.toLowerCase()}`) : undefined) ||
        {};

      const sourceValue = (keys: string[]) => firstValue(sourceRow, keys) || firstValue(row, keys);
      const parsedTime = parseAppointmentWindowRow({ ...row, ...sourceRow });

      const jkNumber =
        firstValue(row, [
          "jk_number",
          "jk",
          "job_number",
          "job_id",
          "appointment_id",
          "appointment_number",
          "confirmation_number",
          "work_order",
          "work_order_number",
          "JK Number",
          "JK",
          "Job Number",
          "Job ID",
          "Appointment ID",
          "Appointment Number",
          "Confirmation Number",
          "Work Order",
          "Work Order Number",
        ]) || "—";

      const customerName =
        sourceValue([
          "customer_name",
          "customer",
          "name",
          "Customer Name",
          "Customer",
          "Name",
        ]) || "—";

      const paymentAmountRaw =
        firstValue(row, [
          "payment_amount",
          "payment",
          "revenue",
          "total",
          "quote",
          "amount",
          "sales",
          "Payment Amount",
          "Payment",
          "Revenue",
          "Total",
          "Quote",
          "Amount",
          "Sales",
        ]) || "0";

      jobs.push({
        appointmentId: apptId || "",
        sourceDate: date,
        jkNumber,
        appointmentUrl: buildJunkwareAppointmentUrl({ ...row, ...sourceRow }),
        appointmentTime: parsedTime.display,
        appointmentStartMinutes: parsedTime.startMinutes,
        appointmentEndMinutes: parsedTime.endMinutes,
        hasScheduledTime: parsedTime.hasScheduledTime,
        customerName,
        customerEmail: firstCustomerEmail(sourceRow, row) || "—",
        customerEmailCollected: hasCustomerEmailField(sourceRow, row),
        phone:
          formatPhone(sourceValue([
            "phone",
            "customer_phone",
            "Phone",
            "Customer Phone",
          ])) || "—",
        address: normalizeAddressLine({ ...row, ...sourceRow }),
        territory:
          sourceValue([
            "normalized_territory",
            "territory",
            "market",
            "franchise",
            "Territory",
            "Market",
            "Franchise",
          ]) || "—",
        appointmentType:
          firstValue(row, [
            "appointment_type",
            "type",
            "job_type",
            "Appointment Type",
            "Type",
            "Job Type",
          ]) || (rowSource.source === "live"
            ? "Open Appointment"
            : rowSource.source === "cancelled"
              ? "Canceled Appointment"
              : "Completed Job"),
        status:
          firstValue(row, [
            "job_status",
            "status",
            "appointment_status",
            "schedule_status",
            "Job Status",
            "Status",
            "Appointment Status",
            "Schedule Status",
          ]) || (rowSource.source === "live"
            ? "Open"
            : rowSource.source === "cancelled"
              ? "Canceled"
              : "Completed"),
        truck:
          sourceValue(["truck", "assigned_truck", "truck_name", "vehicle"]) || "—",
        driver:
          sourceValue(["driver_name", "driver", "driver_normalized_name", "assigned_driver"]) || "—",
        navigator:
          sourceValue(["navigator_name", "navigator", "navigator_normalized_name", "assigned_navigator"]) || "—",
        assignedTruck:
          sourceValue(["assigned_truck", "truck", "truck_name", "vehicle"]) || "—",
        driverName:
          sourceValue(["driver_name", "driver"]) || "—",
        driverNormalizedName:
          sourceValue(["driver_normalized_name", "driver_name", "driver"]) || "—",
        navigatorName:
          sourceValue(["navigator_name", "navigator"]) || "—",
        navigatorNormalizedName:
          sourceValue(["navigator_normalized_name", "navigator_name", "navigator"]) || "—",
        additionalCrew: parseCrewList(sourceValue(["additional_crew"])),
        crewAssignmentSource:
          sourceValue(["crew_assignment_source"]) || "—",
        crewAssignmentStatus:
          sourceValue(["crew_assignment_status"]) || "—",
        paymentType:
          firstValue(row, [
            "payment_type",
            "payment_method",
            "Payment Type",
            "Payment Method",
          ]) || "—",
        paymentAmount: Number(cleanMoneyValue(paymentAmountRaw).replace(/[^0-9.-]/g, "")) || 0,
        tipAmount: Number(
          cleanMoneyValue(firstValue(sourceRow, ["tip", "Tip", "customer_tip", "Customer Tip"]) || firstValue(row, ["tip", "Tip", "customer_tip", "Customer Tip"]) || "0")
            .replace(/[^0-9.-]/g, "")
        ) || 0,
        closeout: parseJobCloseout(sourceRow),
        photos: junkwareJobPhotos(sourceRow),
        photoAuditAvailable: junkwarePhotoAuditAvailable(sourceRow),
        junkItems: junkItemKeywords(sourceRow),
        appointmentNotes: appointmentNotes(sourceRow),
      });
    }
  }

  return jobs.sort((a, b) => {
    const territoryCompare = a.territory.localeCompare(b.territory);
    if (territoryCompare !== 0) return territoryCompare;
    return compareJobSchedule(a, b);
  });
}


function groupJobsByTerritory(jobs: JobRow[]): [string, JobRow[]][] {
  const groups = new Map<string, JobRow[]>();

  for (const job of jobs) {
    const territory = normalizeTerritory(job.territory);

    if (!groups.has(territory)) {
      groups.set(territory, []);
    }

    groups.get(territory)!.push(job);
  }

  const ordered = Array.from(groups.entries()).sort(([a], [b]) => {
    const aIndex = TERRITORY_ORDER.indexOf(a);
    const bIndex = TERRITORY_ORDER.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    }
    return a.localeCompare(b);
  });

  return ordered;
}

function groupJobsBySchedule(jobs: JobRow[]): [string, JobRow[]][] {
  return [["Scheduled by time", [...jobs].sort(compareJobSchedule)]];
}

function territoryTotal(jobs: JobRow[]): number {
  return jobs.reduce(
    (sum, job) => sum + (statusBucket(job) === "Completed" ? Number(job.paymentAmount || 0) : 0),
    0,
  );
}

function appointmentAmountLabel(job: JobRow): string {
  return statusBucket(job) === "Estimate" ? "Estimate value" : "Payment amount";
}

function appointmentStatusLabel(job: JobRow): string {
  const type = job.appointmentType === "—" ? "" : job.appointmentType.trim();
  const status = job.status === "—" ? "" : job.status.trim();
  const completedDuration = status.match(/completed\s+duration:\s*(\d+)\s*min(?:\(s\))?/i);

  if (completedDuration) {
    return `Completed${type ? ` ${type}` : ""}`;
  }

  if (!type && !status) return "Status not available";
  if (!type) return status;
  if (!status) return type;
  if (type.toLowerCase().includes(status.toLowerCase())) return type;
  if (status.toLowerCase().includes(type.toLowerCase())) return status;

  return `${status} ${type}`;
}

function completedDurationLabel(status: string): string {
  const match = String(status || "").match(/(?:completed|confirmed)\s+duration:\s*([\d,]+)\s*min(?:\(s\))?/i);
  return match ? `${match[1]} min` : "";
}

function readFilterValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeTerritory(value: string): string {
  const raw = String(value || "").trim();
  if (!raw || raw === "—") return "Unknown territory";

  const lower = raw.toLowerCase();
  if (lower.includes("new orleans") || lower === "no") return "New Orleans";
  if (lower.includes("northshore") || lower.includes("north shore")) return "Northshore";
  if (lower.includes("baton rouge") || lower === "br") return "Baton Rouge";
  if (lower.includes("unknown")) return "Unknown territory";

  return raw;
}

function statusBucket(job: JobRow): JobStatusBucket {
  const type = String(job.appointmentType || "").toLowerCase();
  const status = String(job.status || "").toLowerCase();

  if (status.includes("cancel")) return "Canceled";
  if (status.includes("unclosed") || status.includes("needs attention") || status.includes("attention")) return "Unclosed or Needs Attention";
  const isClosedOut = status.includes("complete") || status.includes("closed") || status.includes("paid");
  if (isClosedOut && type.includes("estimate")) return "Estimate";
  if (isClosedOut) return "Completed";
  if (status.includes("confirmed") || status.includes("open") || status.includes("schedule")) return "Open / Scheduled";
  return "Unclosed or Needs Attention";
}

function jobMissingPhotos(job: JobRow): boolean {
  return statusBucket(job) === "Completed" && job.photoAuditAvailable && job.photos.length === 0;
}

function cardStatusLabel(job: JobRow): string {
  switch (statusBucket(job)) {
    case "Completed":
      return "Completed";
    case "Estimate":
      return "Estimate";
    case "Open / Scheduled":
      return "Confirmed";
    case "Canceled":
      return "Canceled";
    case "Unclosed or Needs Attention":
      return "Needs attention";
  }
}

function territoryAnchorId(territory: string): string {
  return `territory-${territory.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function territoryToneClass(territory: string): string {
  const normalized = territory.toLowerCase();
  if (normalized.includes("new orleans")) return "is-new-orleans";
  if (normalized.includes("jefferson")) return "is-jefferson";
  if (normalized.includes("northshore")) return "is-northshore";
  if (normalized.includes("baton rouge")) return "is-baton-rouge";
  return "is-unknown-territory";
}

function statusBadgeClass(bucket: JobStatusBucket): string {
  switch (bucket) {
    case "Open / Scheduled":
      return "ops-status-tag scheduled";
    case "Estimate":
      return "ops-status-tag estimate";
    case "Completed":
      return "ops-status-tag completed";
    case "Canceled":
      return "ops-status-tag canceled";
    case "Unclosed or Needs Attention":
      return "ops-status-tag needs-attention";
  }
}

function safeText(value: string): string {
  const text = String(value || "").trim();
  return text && text !== "—" ? text : "Unavailable";
}

function closeoutQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function paymentDetail(payment: JobCloseoutPayment) {
  const cardLastFour = /card/i.test(payment.method)
    ? payment.detail.match(/(\d{4})$/)?.[1]
    : undefined;

  if (cardLastFour) {
    return (
      <span className="ops-job-payment-detail">
        Card ending in <span className="ops-job-payment-last-four">{cardLastFour}</span>
      </span>
    );
  }

  return payment.detail ? <span className="ops-job-payment-detail">{payment.detail}</span> : null;
}

function JobCloseoutDetails({ job }: { job: JobRow }) {
  const closeout = job.closeout;
  if (!closeout || statusBucket(job) !== "Completed") return null;

  return (
    <details className="ops-job-closeout-details">
      <summary>
        <span>Payment details</span>
        <strong>{money(closeout.total || job.paymentAmount)}</strong>
      </summary>
      <div className="ops-job-closeout-body">
        <section className="ops-job-closeout-section" aria-label="Charge breakdown">
          <div className="ops-job-closeout-heading">Charges</div>
          <div className="ops-job-closeout-lines">
            {closeout.loadPrice > 0 ? (
              <div className="ops-job-closeout-line">
                <div>
                  <strong>Load size{closeout.loadSize ? ` · ${closeout.loadSize}` : ""}</strong>
                  {closeout.loadQuantity > 0 ? (
                    <span>{closeoutQuantity(closeout.loadQuantity)} truck{closeout.loadQuantity === 1 ? "" : "s"}</span>
                  ) : null}
                </div>
                <b>{money(closeout.loadPrice)}</b>
              </div>
            ) : null}
            {closeout.bedloadPrice > 0 ? (
              <div className="ops-job-closeout-line">
                <div>
                  <strong>Bedload{closeout.bedloadSize ? ` · ${closeout.bedloadSize}` : ""}</strong>
                  {closeout.bedloadQuantity > 0 ? <span>{closeoutQuantity(closeout.bedloadQuantity)} load{closeout.bedloadQuantity === 1 ? "" : "s"}</span> : null}
                </div>
                <b>{money(closeout.bedloadPrice)}</b>
              </div>
            ) : null}
            {closeout.otherCharges.map((charge, index) => (
              <div className="ops-job-closeout-line" key={`${charge.name}-${index}`}>
                <div>
                  <strong>{charge.name}</strong>
                  {charge.quantity > 0 && charge.unitPrice > 0 ? (
                    <span>{closeoutQuantity(charge.quantity)} × {money(charge.unitPrice)}</span>
                  ) : null}
                </div>
                <b>{money(charge.total)}</b>
              </div>
            ))}
            {closeout.discount > 0 ? (
              <div className="ops-job-closeout-line adjustment">
                <div><strong>Discount</strong></div>
                <b>−{money(closeout.discount)}</b>
              </div>
            ) : null}
            {closeout.tip > 0 ? (
              <div className="ops-job-closeout-line adjustment">
                <div><strong>Tip</strong></div>
                <b>{money(closeout.tip)}</b>
              </div>
            ) : null}
            <div className="ops-job-closeout-total">
              <span>Total charged</span>
              <strong>{money(closeout.total || job.paymentAmount)}</strong>
            </div>
          </div>
        </section>

        <section className="ops-job-closeout-section" aria-label="Payment breakdown">
          <div className="ops-job-closeout-heading">Payments</div>
          <div className="ops-job-closeout-lines">
            {closeout.payments.length ? closeout.payments.map((payment, index) => (
              <div className="ops-job-closeout-line" key={`${payment.method}-${payment.detail}-${index}`}>
                <div>
                  <strong>{payment.method}</strong>
                  {paymentDetail(payment)}
                </div>
                <b>{money(payment.amount)}</b>
              </div>
            )) : (
              <div className="ops-job-closeout-empty">No payment entry was recorded in JunkWare.</div>
            )}
            <div className={`ops-job-closeout-balance${Math.abs(closeout.balance) > 0.005 ? " due" : " paid"}`}>
              <span>Balance</span>
              <strong>{money(closeout.balance)}</strong>
            </div>
          </div>
        </section>
      </div>
    </details>
  );
}

function parseCrewList(value: unknown): string[] {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "[]" || raw === "[ ]") return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => String(entry || "").trim())
          .filter(Boolean);
      }
    } catch {
      // fall back to delimiter parsing below
    }
  }
  return raw
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => entry !== "[]" && entry !== "[ ]");
}

function jobActivityDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00-05:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function JobContextDetails({ job }: { job: JobRow }) {
  const notes = job.appointmentNotes.filter((note) => !/^Appointment moved from\b/i.test(note));
  const notesPreview = notes.join(" • ");
  return (
    <div className="ops-appointment-context">
      <div className="ops-appointment-junk-summary">
        <span>Items to remove</span>
        {job.junkItems.length ? (
          <div>{job.junkItems.map((item) => <strong key={item}>{item}</strong>)}</div>
        ) : <em>Not listed in JunkWare</em>}
      </div>
      {notes.length ? (
        <details className="ops-appointment-note-details">
          <summary>
            <span>Notes</span>
            <strong title={notesPreview}>{notesPreview}</strong>
            {notes.length > 1 ? <small>{notes.length}</small> : null}
          </summary>
          <ul>{notes.map((note, index) => <li key={`${job.appointmentId || job.jkNumber}-note-${index}`}>{note}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

function JobPhotoDetails({ job }: { job: JobRow }) {
  if (jobMissingPhotos(job)) {
    return (
      <div className="ops-job-photo-alert" role="status">
        <span aria-hidden="true">!</span>
        <div>
          <strong>Closeout photos missing</strong>
          <small>JunkWare was checked and no job photos were uploaded.</small>
        </div>
      </div>
    );
  }

  if (!job.photos.length) return null;

  return (
    <details className="ops-job-photo-details">
      <summary>
        <span>Job photos</span>
        <strong>{job.photos.length} uploaded</strong>
      </summary>
      <div className="ops-job-photo-gallery">
        {job.photos.map((photo, index) => (
          <a
            href={photo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ops-job-photo"
            key={`${photo.url}-${index}`}
            aria-label={`Open ${photo.category.toLowerCase()} photo ${index + 1}`}
          >
            <img src={photo.url} alt={`${photo.category} job photo ${index + 1}`} loading="lazy" />
            <span>{photo.category}</span>
          </a>
        ))}
      </div>
    </details>
  );
}

function filterJobs(jobs: JobRow[], filters: JobsFilters): JobRow[] {
  const query = filters.q.trim().toLowerCase();
  const territory = filters.territory.trim().toLowerCase();
  const status = filters.status.trim().toLowerCase();
  const paymentType = filters.paymentType.trim().toLowerCase();
  const truck = filters.truck.trim().toLowerCase();

  return jobs.filter((job) => {
    if (territory && normalizeTerritory(job.territory).toLowerCase() !== territory) return false;
    if (status && statusBucket(job).toLowerCase() !== status) return false;
    if (paymentType && String(job.paymentType || "").trim().toLowerCase() !== paymentType) return false;
    if (truck && String(job.truck || "").trim().toLowerCase() !== truck) return false;

    if (query) {
      const haystack = [
        job.jkNumber,
        job.customerName,
        job.phone,
        job.address,
        job.appointmentTime,
        job.appointmentType,
        job.status,
        job.truck,
        job.driver,
        job.navigator,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}

function timedJobs(job: JobRow): boolean {
  return job.hasScheduledTime || job.appointmentStartMinutes !== null;
}

function planningTruckLabel(value: string): string {
  const match = String(value || "").match(/truck\s*#?\s*(\d+)/i);
  return match ? `Truck ${match[1]}` : "";
}

function applyJobRouteAssignmentOverrides(jobs: JobRow[], date: string): JobRow[] {
  const overrides = readJobRouteAssignmentOverrides(date);
  if (!overrides.size) return jobs;

  return jobs.map((job) => {
    const key = jobRouteAssignmentKey(job);
    const override = overrides.get(key);
    if (!override) return job;
    const truck = override.truck || "—";
    return {
      ...job,
      truck,
      assignedTruck: truck,
      ...(override.appointmentTime ? { appointmentTime: override.appointmentTime } : {}),
      ...(override.appointmentStartMinutes !== undefined
        ? { appointmentStartMinutes: override.appointmentStartMinutes, hasScheduledTime: true }
        : {}),
      ...(override.appointmentEndMinutes !== undefined
        ? { appointmentEndMinutes: override.appointmentEndMinutes }
        : {}),
    };
  });
}

function planningTruckOptions(jobs: JobRow[]): string[] {
  const trucks = new Set(
    jobs
      .map((job) => planningTruckLabel(job.assignedTruck || job.truck))
      .filter(Boolean),
  );
  const mappingFile = path.join(process.cwd(), "data", "config", "linxup_vehicle_map.json");

  try {
    const payload = JSON.parse(fs.readFileSync(mappingFile, "utf8"));
    for (const mapping of Array.isArray(payload?.mappings) ? payload.mappings : []) {
      const truck = planningTruckLabel(String(mapping?.junkware_truck_number || ""));
      if (truck) trucks.add(truck);
    }
    for (const value of payload?.unresolved?.junkware_trucks_without_verified_trackers || []) {
      const truck = planningTruckLabel(String(value || ""));
      if (truck) trucks.add(truck);
    }
  } catch {
    // Existing scheduled trucks remain available if the fleet mapping is unavailable.
  }

  return Array.from(trucks).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function planningAddressHash(address: string): string {
  const normalized = String(address || "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim()
    .toUpperCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function readPlanningGeocodes(): Record<string, Record<string, unknown>> {
  const file = path.join(OPSBOT_DATA_DIR, "cache", "appointment_geocodes.json");
  if (!fs.existsSync(file)) return {};
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return payload?.addresses && typeof payload.addresses === "object" ? payload.addresses : {};
  } catch {
    return {};
  }
}

function planningLocation(
  address: string,
  geocodes: Record<string, Record<string, unknown>>,
): RouteLocation | null {
  if (!address || address === "—") return null;
  const match = geocodes[planningAddressHash(address)];
  const latitude = Number(match?.latitude);
  const longitude = Number(match?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function routeDistanceMiles(from: RouteLocation, to: RouteLocation): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const latDelta = radians(to.latitude - from.latitude);
  const lngDelta = radians(to.longitude - from.longitude);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(lngDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routeDirectionsUrl(jobs: JobRow[]): string {
  const addresses = jobs
    .map((job) => String(job.address || "").trim())
    .filter((address) => address && address !== "—");
  if (!addresses.length) return "";
  if (addresses.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addresses[0])}`;
  }

  const params = new URLSearchParams({
    api: "1",
    origin: addresses[0],
    destination: addresses[addresses.length - 1],
    travelmode: "driving",
  });
  if (addresses.length > 2) params.set("waypoints", addresses.slice(1, -1).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildJobsRoutePlan(jobs: JobRow[]): JobsRoutePlan {
  const planningJobs = jobs
    .filter((job) => statusBucket(job) === "Open / Scheduled" && timedJobs(job))
    .sort(compareJobSchedule);
  const geocodes = readPlanningGeocodes();
  const grouped = new Map<string, JobRow[]>();
  const unassignedJobs: JobRow[] = [];

  for (const job of planningJobs) {
    const truck = planningTruckLabel(job.assignedTruck || job.truck);
    if (!truck) {
      unassignedJobs.push(job);
      continue;
    }
    if (!grouped.has(truck)) grouped.set(truck, []);
    grouped.get(truck)!.push(job);
  }

  const routes = Array.from(grouped.entries())
    .map(([truck, truckJobs]) => {
      const orderedJobs = [...truckJobs].sort(compareJobSchedule);
      const stops = orderedJobs.map((job, index): RoutePlanStop => {
        const location = planningLocation(job.address, geocodes);
        const previous = index > 0 ? orderedJobs[index - 1] : null;
        const previousLocation = previous ? planningLocation(previous.address, geocodes) : null;
        const distanceFromPreviousMiles = previousLocation && location
          ? routeDistanceMiles(previousLocation, location)
          : null;
        const previousEnd = previous
          ? previous.appointmentEndMinutes ??
            (previous.appointmentStartMinutes == null ? null : previous.appointmentStartMinutes + 60)
          : null;
        const bufferFromPreviousMinutes = previousEnd != null && job.appointmentStartMinutes != null
          ? job.appointmentStartMinutes - previousEnd
          : null;
        const travelAllowanceMinutes = distanceFromPreviousMiles == null
          ? null
          : Math.ceil((distanceFromPreviousMiles * 1.2 * 60) / 28 + 5);

        let warning: string | null = null;
        if (bufferFromPreviousMinutes != null && bufferFromPreviousMinutes < 0) {
          warning = `Windows overlap by ${Math.abs(bufferFromPreviousMinutes)} min`;
        } else if (bufferFromPreviousMinutes === 0) {
          warning = "No travel buffer between appointment windows";
        } else if (
          bufferFromPreviousMinutes != null &&
          travelAllowanceMinutes != null &&
          bufferFromPreviousMinutes < travelAllowanceMinutes
        ) {
          warning = `${Math.round(distanceFromPreviousMiles || 0)} mi with only ${bufferFromPreviousMinutes} min between windows`;
        } else if (previous && normalizeTerritory(previous.territory) !== normalizeTerritory(job.territory)) {
          warning = `Cross-territory handoff from ${normalizeTerritory(previous.territory)}`;
        }

        return {
          job,
          location,
          distanceFromPreviousMiles,
          bufferFromPreviousMinutes,
          travelAllowanceMinutes,
          warning,
        };
      });

      return {
        truck,
        stops,
        directionsUrl: routeDirectionsUrl(orderedJobs),
        warningCount: stops.filter((stop) => stop.warning).length,
      };
    })
    .sort((a, b) => a.truck.localeCompare(b.truck, undefined, { numeric: true }));

  return {
    planningJobs,
    assignedJobs: routes.reduce((sum, route) => sum + route.stops.length, 0),
    locatedJobs: planningJobs.filter((job) => planningLocation(job.address, geocodes)).length,
    unassignedJobs,
    routes,
  };
}

function buildJobsMapPoints(
  jobs: JobRow[],
  siteTimeByKey: Map<string, SiteTimeAppointment>,
  gpsVisitedTrucksByJobKey: Map<string, string[]>,
): JobsMapPoint[] {
  const geocodes = readPlanningGeocodes();

  return jobs.map((job, index) => {
    const location = planningLocation(job.address, geocodes);
    const siteTime = siteTimeLookupKeys(job)
      .map((key) => siteTimeByKey.get(key))
      .find(Boolean);
    const trucksOnSite = Array.from(new Set((siteTime?.trucks || [])
      .filter((truck) =>
        (truck.arrival && !truck.departure) || truck.intervals.some((interval) => interval.arrival && !interval.departure)
      )
      .map((truck) => truck.truck)
      .filter(Boolean)));
    const visitedTrucks = Array.from(new Set([
      ...siteTimeVisitedTrucks(siteTime),
      ...(gpsVisitedTrucksByJobKey.get(jobKey(job)) || []),
    ]));
    return {
      key: `${jobKey(job)}:${index}`,
      detailId: appointmentCardId(job),
      assignmentKey: jobRouteAssignmentKey(job),
      appointmentId: job.appointmentId,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      customerName: job.customerName,
      address: job.address,
      territory: normalizeTerritory(job.territory),
      appointmentTime: job.appointmentTime,
      appointmentStartMinutes: job.appointmentStartMinutes,
      appointmentEndMinutes: job.appointmentEndMinutes,
      appointmentType: job.appointmentType,
      phone: job.phone,
      status: job.status,
      statusBucket: statusBucket(job),
      truckOnSite: trucksOnSite.length > 0,
      trucksOnSite,
      visitedTrucks,
      truck: safeText(job.assignedTruck || job.truck),
      jkNumber: job.jkNumber,
      appointmentUrl: job.appointmentUrl,
      junkItems: job.junkItems,
      appointmentNotes: job.appointmentNotes.filter((note) => !/^Appointment moved from\b/i.test(note)),
    };
  });
}

function uniqueSorted(values: string[], canonicalize = (value: string) => value): string[] {
  return Array.from(new Set(values.map((value) => canonicalize(value)).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: Promise<AnyRecord>;
}) {
  noStore();
  const params = searchParams ? await searchParams : undefined;
  const requestedDate = typeof params?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date
    : null;
  const date = requestedDate || resolveDate(params, { allowTomorrow: true });
  const view = normalizeJobsView(params?.view);
  const workspace = normalizeJobsWorkspace(params?.workspace);
  const requestedMonthlySection = String(params?.section || "overview").toLowerCase();
  const monthlySection = ["overview", "breakdown", "trend"].includes(requestedMonthlySection)
    ? requestedMonthlySection
    : "overview";
  const isMonthView = view === "calendar" || view === "monthly";
  const metrics = readMetrics(date);
  const month = isMonthView ? buildMonthlyRange(date) : null;
  const monthlySummary = isMonthView ? buildMonthlyJobsSummary(date) : null;
  const monthlyAuthority = view === "monthly" ? readMonthlyAuthority(date) : null;
  const jobs = view === "daily"
    ? applyJobRouteAssignmentOverrides(readJobRows(date), date)
    : monthlySummary?.jobs || readJobRows(date);
  const callAheadStatuses = readJobCallAheadStatuses();
  const filters: JobsFilters = {
    territory: readFilterValue(params?.territory),
    status: readFilterValue(params?.status),
    paymentType: readFilterValue(params?.paymentType),
    truck: readFilterValue(params?.truck),
    q: readFilterValue(params?.q),
    siteTime: readFilterValue(params?.siteTime),
  };
  let filteredJobs = filterJobs(jobs, filters);
  const siteTimePreview = monthlySummary ? Array.from(monthlySummary.siteTimeByKey.values()) : readAppointmentSiteTime(date);
  const siteTimeByKey = new Map<string, SiteTimeAppointment>();
  for (const appointment of siteTimePreview) {
    for (const key of [appointment.appointmentId, appointment.jkNumber]) {
      const normalized = String(key || "").trim().toLowerCase();
      if (normalized) siteTimeByKey.set(normalized, appointment);
    }
  }
  if (filters.siteTime === "overHour") {
    filteredJobs = filteredJobs.filter((job) => {
      const appointment = siteTimeLookupKeys(job)
        .map((key) => siteTimeByKey.get(key))
        .find((value): value is SiteTimeAppointment => Boolean(value));
      if (!appointment) return false;
      const totalMinutes = appointment.trucks.reduce((sum, truck) => sum + Number(siteTimeTruckDurationMinutes(truck) || 0), 0);
      return totalMinutes > 60;
    });
  }
  const groupedJobs = groupJobsByTerritory(filteredJobs);
  const jobsExceptions = buildOperationalExceptions(date).exceptions.filter((exception) => exception.category === "Jobs");
  const exceptionByJob = new Map<string, (typeof jobsExceptions)[number][]>();
  for (const exception of jobsExceptions) {
    const keys = [exception.entityId, exception.entityLabel].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
    for (const key of keys) {
      if (!exceptionByJob.has(key)) exceptionByJob.set(key, []);
      exceptionByJob.get(key)!.push(exception);
    }
  }
  const getJobExceptions = (job: JobRow) => {
    const keys = [
      String(job.jkNumber || "").trim().toLowerCase(),
      String(job.appointmentUrl || "").trim().toLowerCase(),
    ].filter(Boolean);
    const merged = new Map<string, (typeof jobsExceptions)[number]>();
    for (const key of keys) {
      for (const exception of exceptionByJob.get(key) || []) {
        merged.set(exception.id, exception);
      }
    }
    return Array.from(merged.values());
  };
  const allTerritories = uniqueSorted(jobs.map((job) => normalizeTerritory(job.territory)), (value) => value);
  const allStatuses = STATUS_ORDER.slice();
  const allPaymentTypes = uniqueSorted(jobs.map((job) => safeText(job.paymentType).replace(/\s+/g, " ").trim()), (value) => value);
  const allTrucks = uniqueSorted(jobs.map((job) => safeText(job.truck).replace(/\s+/g, " ").trim()), (value) => value);

  const grossRevenue = monthlySummary
    ? (monthlyAuthority?.grossRevenue ?? monthlySummary.totalRevenue)
    : jobs.reduce(
        (sum, job) => sum + (statusBucket(job) === "Completed" ? Number(job.paymentAmount || 0) : 0),
        0,
      );
  const completed = monthlySummary
    ? (monthlyAuthority?.completedJobs ?? monthlySummary.completedJobsCount)
    : completedJobs(metrics);
  const estimates = monthlySummary ? monthlySummary.estimateRows.length : jobs.filter((job) =>
    job.appointmentType.toLowerCase().includes("estimate")
  ).length;

  const completedVisible = jobs.filter((job) =>
    job.status.toLowerCase().includes("complete")
  ).length;

  const collected = jobs.reduce(
    (sum, job) => sum + (statusBucket(job) === "Completed" ? Number(job.paymentAmount || 0) : 0),
    0,
  );
  const avgJob = completed > 0 ? grossRevenue / completed : 0;
  const filterCount = filteredJobs.length;
  const fleetMapPayload = view === "daily" ? buildFleetMapPayload(date) : null;
  const gpsVisitedTrucksByJobKey = new Map(filteredJobs.map((job) => [
    jobKey(job),
    gpsVisitedTrucks(job, fleetMapPayload?.trucks || []),
  ]));
  const mapPoints = buildJobsMapPoints(filteredJobs, siteTimeByKey, gpsVisitedTrucksByJobKey);
  const unclosedNeedsAttention = jobs.filter((job) => statusBucket(job) === "Unclosed or Needs Attention").length;
  const missingPhotoJobs = jobs.filter(jobMissingPhotos).length;
  const needsAttention = unclosedNeedsAttention + missingPhotoJobs;
  const scheduledOpen = jobs.filter((job) => statusBucket(job) === "Open / Scheduled").length;
  const hasActiveFilters = Object.values(filters).some(Boolean);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const dayActivity = view === "daily"
    ? readJunkwareDayActivity(OPSBOT_DATA_DIR, date)
    : { rescheduled: [], cancelled: [] };
  const routeTrucks = view === "daily" ? planningTruckOptions(jobs) : [];
  const mapTrucks = (fleetMapPayload?.trucks || [])
    .filter((truck) => truck.hasCoordinates && Number.isFinite(truck.latitude) && Number.isFinite(truck.longitude))
    .map((truck) => ({
      truck: truck.truck,
      latitude: truck.latitude as number,
      longitude: truck.longitude as number,
      status: truck.operationalStatus,
      freshness: truck.freshnessLabel,
      lastGpsUpdate: truck.lastGpsUpdate,
      driver: truck.driver,
      navigator: truck.navigator,
      recentPoints: truck.routePoints.slice(-8).map((point) => ({
        timestamp: point.timestamp,
        latitude: point.latitude,
        longitude: point.longitude,
        continuousUntil: point.continuousUntil,
      })),
      recentStops: truck.gpsStops.filter((stop) => {
        const begin = Date.parse(stop.begin);
        const end = Date.parse(stop.end);
        return Number.isFinite(begin) && Number.isFinite(end) && end - begin >= 2 * 60_000;
      }).map((stop) => ({
        latitude: stop.latitude,
        longitude: stop.longitude,
        begin: stop.begin,
        end: stop.end,
      })),
    }));
  const scheduleCopy = scheduleDayCopy(date);
  const today = chicagoDateKey();
  const tomorrow = addDays(today, 1);
  const scheduleDates = Array.from(new Set([tomorrow, today, ...availableDates()])).sort((a, b) =>
    b.localeCompare(a),
  );
  const monthCalendarDays = monthlySummary ? calendarDays(date, monthlySummary.jobsByDate) : [];
  const calendarScheduledCount = monthlySummary
    ? Array.from(monthlySummary.jobsByDate.values()).flat().filter((job) => statusBucket(job) !== "Canceled").length
    : 0;
  const requestedCalendarDay = typeof params?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.day)
    && params.day.startsWith(`${date.slice(0, 7)}-`)
    ? params.day
    : "";
  const defaultCalendarDay = today.startsWith(`${date.slice(0, 7)}-`)
    ? today
    : monthCalendarDays.find((day) => day?.jobs.length)?.date || `${date.slice(0, 7)}-01`;
  const selectedCalendarDate = requestedCalendarDay || defaultCalendarDay;
  const selectedCalendarDay = monthCalendarDays.find((day) => day?.date === selectedCalendarDate) || null;

  return (
    <div className="ops-dashboard ops-jobs-page">
      <PageHeader
        title={view === "daily" ? "Dispatch board" : "Jobs"}
        subtitle={isMonthView
          ? view === "calendar"
            ? `${month?.monthDisplay || monthlySummary?.monthDisplay || date.slice(0, 7)} schedule · ${calendarScheduledCount} appointment${calendarScheduledCount === 1 ? "" : "s"} on file`
            : `Monthly summary for ${month?.monthDisplay || monthlySummary?.monthDisplay || date.slice(0, 7)} · ${month?.warningLabel || "Monthly data"} · Data through ${month?.dataThroughLabel || date}`
          : `${scheduleCopy.possessive} route plan · ${scheduledOpen} open · ${needsAttention} need attention`}
        date={date}
        dates={scheduleDates}
        showDateSelector={!isMonthView}
        dateLabel={isMonthView ? "Month" : "Date"}
        lastUpdated={monthlyAuthority?.verifiedAt || metrics?.generated_at}
        controls={
          <>
            {isMonthView ? (
              <OpsMonthSelector months={jobsMonthOptions()} selectedMonthKey={date.slice(0, 7)} currentMonthKey={today.slice(0, 7)} />
            ) : <ScheduleDayToggle date={date} workspace={workspace} filters={filters} />}
          </>
        }
        sections={[
          { label: "Dispatch", href: buildJobsHref({ date, view: "daily", workspace: "dispatch", ...filters }), active: view === "daily", badge: view === "daily" ? mapPoints.length || undefined : undefined },
          { label: "Calendar", href: buildJobsHref({ date, view: "calendar", ...filters }), active: view === "calendar" },
          { label: "Monthly Summary", href: buildJobsHref({ date, view: "monthly", ...filters }), active: view === "monthly" },
        ]}
      />

      {monthlySummary && view === "calendar" ? (
        <section className="ops-card ops-jobs-calendar-card" aria-label={`${monthlySummary.monthDisplay} job calendar`}>
          <div className="ops-jobs-calendar-head">
            <div>
              <div className="ops-section-title">{monthlySummary.monthDisplay}</div>
              <div className="ops-muted">Choose a day to see every appointment below the calendar.</div>
            </div>
            <div className="ops-jobs-calendar-legend" aria-label="Job status legend">
              <span><i className="is-scheduled" /> Scheduled</span>
              <span><i className="is-estimate" /> Estimate</span>
              <span><i className="is-completed" /> Completed</span>
              <span><i className="is-attention" /> Attention</span>
              <span><i className="is-canceled" /> Canceled</span>
            </div>
          </div>
          <div className="ops-jobs-calendar-scroll">
            <div className="ops-jobs-calendar-grid">
              {CALENDAR_WEEKDAYS.map((weekday) => (
                <div className="ops-jobs-calendar-weekday" key={weekday}>{weekday}</div>
              ))}
              {monthCalendarDays.map((day, index) => day ? (
                <article
                  className={`ops-jobs-calendar-day${day.date === today ? " is-today" : ""}${day.date < today ? " is-past" : ""}${day.date === selectedCalendarDate ? " is-selected" : ""}`}
                  key={day.date}
                >
                  <div className="ops-jobs-calendar-date-row">
                    <Link href={`/jobs?date=${date.slice(0, 7)}-01&view=calendar&day=${day.date}#calendar-day-appointments`} aria-label={`Show appointments for ${day.date}`}>
                      {day.dayNumber}
                    </Link>
                    {day.jobs.length ? <span>{day.jobs.length} job{day.jobs.length === 1 ? "" : "s"}</span> : null}
                  </div>
                  <div className="ops-jobs-calendar-appointments">
                    {day.jobs.slice(0, 4).map((job) => (
                      <a
                        className={`ops-jobs-calendar-job ${calendarStatusClass(job)}`}
                        href={job.appointmentUrl || buildJobsHref({ date: day.date, view: "daily", workspace: "dispatch" })}
                        target={job.appointmentUrl ? "_blank" : undefined}
                        rel={job.appointmentUrl ? "noopener noreferrer" : undefined}
                        key={`${day.date}-${jobKey(job)}`}
                      >
                        <strong><time>{job.appointmentTime}</time> {safeText(job.customerName)}</strong>
                        <span>{calendarJobMeta(job)}</span>
                      </a>
                    ))}
                    {day.jobs.length > 4 ? (
                      <Link className="ops-jobs-calendar-more" href={`/jobs?date=${date.slice(0, 7)}-01&view=calendar&day=${day.date}#calendar-day-appointments`}>
                        +{day.jobs.length - 4} more
                      </Link>
                    ) : null}
                  </div>
                </article>
              ) : <div className="ops-jobs-calendar-day is-outside" aria-hidden="true" key={`empty-${index}`} />)}
            </div>
          </div>
          <div className="ops-jobs-calendar-day-list" id="calendar-day-appointments">
            <div className="ops-jobs-calendar-day-list-head">
              <div>
                <div className="ops-section-title">{jobActivityDate(selectedCalendarDate)}</div>
                <div className="ops-muted">
                  {selectedCalendarDay?.jobs.length || 0} appointment{selectedCalendarDay?.jobs.length === 1 ? "" : "s"}
                </div>
              </div>
              <Link href={buildJobsHref({ date: selectedCalendarDate, view: "daily", workspace: "dispatch" })}>
                Open dispatch
              </Link>
            </div>
            {selectedCalendarDay?.jobs.length ? (
              <div className="ops-jobs-calendar-day-rows">
                {selectedCalendarDay.jobs.map((job) => {
                  const assignedCrew = [job.driverName || job.driver, job.navigatorName || job.navigator, ...(job.additionalCrew || [])]
                    .map((name) => String(name || "").trim())
                    .filter((name) => name && name !== "—");
                  return (
                    <article className={`ops-jobs-calendar-list-row ${calendarStatusClass(job)}`} key={`${selectedCalendarDate}-list-${jobKey(job)}`}>
                      <div className="ops-jobs-calendar-list-time">
                        <time>{job.appointmentTime}</time>
                        <span className={statusBadgeClass(statusBucket(job))}>{cardStatusLabel(job)}</span>
                      </div>
                      <div className="ops-jobs-calendar-list-customer">
                        <strong>{safeText(job.customerName)}</strong>
                        <span>{safeText(job.address)}</span>
                      </div>
                      <div className="ops-jobs-calendar-list-assignment">
                        <strong>{calendarJobMeta(job)}</strong>
                        <span>{assignedCrew.length ? assignedCrew.join(" · ") : "Crew not assigned"}</span>
                      </div>
                      <div className="ops-jobs-calendar-list-contact">
                        {job.phone && job.phone !== "—" ? <a href={`tel:${job.phone.replace(/[^\d+]/g, "")}`}>{job.phone}</a> : <span>Phone unavailable</span>}
                        {job.appointmentUrl ? <a href={job.appointmentUrl} target="_blank" rel="noopener noreferrer">{safeText(job.jkNumber)} ↗</a> : <span>{safeText(job.jkNumber)}</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="ops-jobs-calendar-day-empty">No appointments are currently on file for this day.</div>
            )}
          </div>
        </section>
      ) : null}

      {(view === "daily" || (view === "monthly" && monthlySection === "overview")) ? <div className="ops-kpi-row ops-jobs-kpi-strip" id="jobs-overview">
        <div className={`ops-card ops-kpi-card ops-jobs-priority-card${needsAttention > 0 ? " has-attention" : ""}`}>
          <div className="ops-card-title">Needs attention</div>
          <div className="ops-kpi-value">{needsAttention}</div>
          <div className="ops-kpi-sub">
            {needsAttention
              ? `${unclosedNeedsAttention} unclosed · ${missingPhotoJobs} missing photos`
              : "Nothing urgent"}
          </div>
        </div>

        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Open jobs</div>
          <div className="ops-kpi-value">{scheduledOpen}</div>
          <div className="ops-kpi-sub">Upcoming appointments</div>
        </div>

        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Closed jobs</div>
          <div className="ops-kpi-value">{completed || completedVisible}</div>
          <div className="ops-kpi-sub">
            {monthlyAuthority && monthlyAuthority.jobDelta !== 0
              ? `${monthlyAuthority.itemizedJobs} itemized · ${monthlyAuthority.jobDelta} awaiting itemization · ${estimates} estimates`
              : `${estimates} estimates`}
          </div>
        </div>

        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Revenue</div>
          <div className="ops-kpi-value ops-kpi-accent">{money(grossRevenue)}</div>
          <div className="ops-kpi-sub">
            {monthlyAuthority && monthlyAuthority.revenueDelta !== 0
              ? `${money(monthlyAuthority.itemizedRevenue)} itemized · ${money(monthlyAuthority.revenueDelta)} awaiting itemization`
              : `${money(avgJob)} average job${monthlyAuthority ? " · JunkWare Dashboard" : ""}`}
          </div>
        </div>
      </div> : null}

      {view === "daily" && (dayActivity.rescheduled.length || dayActivity.cancelled.length) ? (
        <section className="ops-job-activity" id="jobs-changes" aria-label="Schedule changes">
          <details className="ops-card ops-job-activity-card ops-job-activity-combined">
            <summary className="ops-job-activity-summary">
              <span className="ops-job-activity-heading">
                <strong>{dayActivity.rescheduled.length + dayActivity.cancelled.length} schedule changes</strong>
                <small>{dayActivity.rescheduled.length} rescheduled · {dayActivity.cancelled.length} cancelled</small>
              </span>
              <span className="ops-job-activity-summary-meta">
                <span className="ops-job-activity-view-label">View changes</span>
                <span className="ops-job-activity-chevron" aria-hidden="true">⌄</span>
              </span>
            </summary>
            <div className="ops-job-activity-groups">
              {dayActivity.rescheduled.length ? (
                <div className="ops-job-activity-group rescheduled">
                  <div className="ops-job-activity-group-title">Rescheduled <span>{dayActivity.rescheduled.length}</span></div>
                  <div className="ops-job-activity-list">
                    {dayActivity.rescheduled.map((event) => (
                      <article key={`${event.appointmentId || event.jkNumber}-${event.fromDate}-${event.fromTime}-${event.toDate}-${event.toTime}`}>
                        <div className="ops-job-activity-title">
                          {event.appointmentUrl ? (
                            <a href={event.appointmentUrl} target="_blank" rel="noopener noreferrer">{safeText(event.jkNumber)}</a>
                          ) : <strong>{safeText(event.jkNumber)}</strong>}
                          {event.customerName ? <span>{event.customerName}</span> : null}
                        </div>
                        <div className="ops-reschedule-path">
                          <div><small>Was</small><strong>{jobActivityDate(event.fromDate)}</strong><span>{event.fromTime}</span></div>
                          <span aria-hidden="true">→</span>
                          <div><small>Now</small><strong>{jobActivityDate(event.toDate)}</strong><span>{event.toTime}</span></div>
                        </div>
                        <div className="ops-job-activity-meta">
                          {event.territory || "Territory unavailable"}
                          {event.changedBy ? ` · Changed by ${event.changedBy}` : ""}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}

              {dayActivity.cancelled.length ? (
                <div className="ops-job-activity-group cancelled">
                  <div className="ops-job-activity-group-title">Cancelled <span>{dayActivity.cancelled.length}</span></div>
                  <div className="ops-job-activity-list">
                    {dayActivity.cancelled.map((event, index) => (
                      <article key={`${event.appointmentId || event.jkNumber}-${index}`}>
                        <div className="ops-job-activity-title">
                          {event.appointmentUrl ? (
                            <a href={event.appointmentUrl} target="_blank" rel="noopener noreferrer">{safeText(event.jkNumber)}</a>
                          ) : <strong>{safeText(event.jkNumber)}</strong>}
                          {event.customerName ? <span>{event.customerName}</span> : null}
                        </div>
                        <div className="ops-cancellation-summary">
                          <strong>{event.appointmentTime || "Time unavailable"}</strong>
                          <span>{event.cancelledBy ? `Cancelled by ${event.cancelledBy}` : "Cancelled"}</span>
                        </div>
                        {event.reason ? <p>{event.reason}</p> : null}
                        <div className="ops-job-activity-meta">{event.territory || "Territory unavailable"}</div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </details>
        </section>
      ) : null}

      {view === "monthly" && monthlySummary && (
        <>
          <nav className="ops-monthly-summary-tabs" aria-label="Monthly summary sections">
            <Link href={`/jobs?date=${date}&view=monthly&section=overview`} className={monthlySection === "overview" ? "active" : ""}>Overview</Link>
            <Link href={`/jobs?date=${date}&view=monthly&section=breakdown`} className={monthlySection === "breakdown" ? "active" : ""}>Breakdown</Link>
            <Link href={`/jobs?date=${date}&view=monthly&section=trend`} className={monthlySection === "trend" ? "active" : ""}>Daily trend</Link>
          </nav>
          {monthlySection === "overview" ? <div className="ops-monthly-insight-grid">
            <section className="ops-card ops-monthly-insight-card">
              <div className="ops-monthly-insight-heading">
                <div>
                  <div className="ops-card-title">Appointment Activity</div>
                  <div className="ops-muted">Volume and exceptions this month</div>
                </div>
                <strong>{monthlySummary.jobs.length}</strong>
              </div>
              <dl>
                <div><dt>Estimates</dt><dd>{monthlySummary.estimateRows.length}</dd></div>
                <div><dt>Cancelled</dt><dd>{monthlySummary.canceledRows.length}</dd></div>
                <div><dt>Unclosed</dt><dd>{monthlySummary.unclosedRows.length}</dd></div>
              </dl>
            </section>

            <section className="ops-card ops-monthly-insight-card">
              <div className="ops-monthly-insight-heading">
                <div>
                  <div className="ops-card-title">Tips and Conversion</div>
                  <div className="ops-muted">Customer tips and estimate outcomes</div>
                </div>
                <strong>{money(monthlySummary.totalTips)}</strong>
              </div>
              <dl>
                <div><dt>Jobs with tips</dt><dd>{monthlySummary.tippedJobs} <small>{monthlySummary.tippedJobRate == null ? "—" : `${(monthlySummary.tippedJobRate * 100).toFixed(1)}%`}</small></dd></div>
                <div><dt>Average tipped job</dt><dd>{monthlySummary.averageTipPerTippedJob == null ? "—" : money(monthlySummary.averageTipPerTippedJob)}</dd></div>
                <div><dt>Estimate close rate</dt><dd>{monthlySummary.estimateCloseRate == null ? "—" : `${(monthlySummary.estimateCloseRate * 100).toFixed(1)}%`} <small>{monthlySummary.estimatedToJobConversions} converted</small></dd></div>
              </dl>
            </section>

            <section className="ops-card ops-monthly-insight-card">
              <div className="ops-monthly-insight-heading">
                <div>
                  <div className="ops-card-title">Truck Site Time</div>
                  <div className="ops-muted">Time spent at completed appointments</div>
                </div>
                <strong>{siteDurationLabel(monthlySummary.totalSiteMinutes)}</strong>
              </div>
              <dl>
                <div><dt>Average per completed job</dt><dd>{siteDurationLabel(monthlySummary.averageTruckSiteTimePerCompletedJob)}</dd></div>
                <div><dt>Median appointment</dt><dd>{siteDurationLabel(monthlySummary.medianTruckSiteTime)}</dd></div>
                <div><dt>Jobs over one hour</dt><dd>{monthlySummary.jobsOverOneHour} <small>{monthlySummary.percentJobsOverOneHour == null ? "—" : `${(monthlySummary.percentJobsOverOneHour * 100).toFixed(1)}%`}</small></dd></div>
              </dl>
            </section>
          </div> : null}

          {monthlySection === "breakdown" ? <div className="ops-card" id="jobs-monthly-breakdown">
            <div className="ops-card-header compact">
              <div>
                <div className="ops-section-title">Monthly Territory and Payment Breakdown</div>
                <div className="ops-muted">Revenue, jobs, and site time aggregated from published daily records only.</div>
              </div>
            </div>
            <div className="ops-grid ops-grid-2 monthly-breakdown-grid">
              <div>
                <div className="ops-card-title">Revenue and Jobs by Territory</div>
                <div className="ops-wide-table-wrap">
                  <table className="ops-table ops-jobs-trend-table">
                    <thead>
                      <tr>
                        <th>Territory</th>
                        <th>Revenue</th>
                        <th>Jobs</th>
                        <th>Site Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(monthlySummary.revenueByTerritory.entries()).map(([territory, revenue]) => (
                        <tr key={territory}>
                          <td>{territory}</td>
                          <td>{money(revenue)}</td>
                          <td>{monthlySummary.jobsByTerritory.get(territory) || 0}</td>
                          <td>{siteDurationLabel(monthlySummary.siteTimeByTerritory.get(territory))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <div className="ops-card-title">Revenue and Jobs by Payment Type</div>
                <div className="ops-wide-table-wrap">
                  <table className="ops-table ops-jobs-trend-table">
                    <thead>
                      <tr>
                        <th>Payment Type</th>
                        <th>Revenue</th>
                        <th>Jobs</th>
                        <th>Truck Site Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(monthlySummary.revenueByPaymentType.entries()).map(([paymentType, revenue]) => (
                        <tr key={paymentType}>
                          <td>{paymentType}</td>
                          <td>{money(revenue)}</td>
                          <td>{monthlySummary.jobsByPaymentType.get(paymentType) || 0}</td>
                          <td>{siteDurationLabel(monthlySummary.siteTimeByPaymentType.get(paymentType))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="ops-card-title" style={{ marginTop: 12 }}>Truck Site Time by Truck</div>
            <div className="ops-wide-table-wrap">
              <table className="ops-table ops-jobs-trend-table">
                <thead>
                  <tr>
                    <th>Truck</th>
                    <th>Site Time</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(monthlySummary.siteTimeByTruck.entries()).map(([truck, minutes]) => (
                    <tr key={truck}>
                      <td>{truck}</td>
                      <td>{siteDurationLabel(minutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div> : null}

          {monthlySection === "trend" ? <div className="ops-card" id="jobs-monthly-trend">
            <div className="ops-card-header compact">
              <div>
                <div className="ops-section-title">Daily Revenue and Job-Count Trend</div>
                <div className="ops-muted">Daily revenue and completed job counts for the selected month.</div>
              </div>
            </div>
            <div className="ops-wide-table-wrap">
              <table className="ops-table ops-jobs-trend-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Revenue</th>
                    <th>Completed Jobs</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(monthlySummary.dailyTrend.entries()).map(([trendDate, trend]) => (
                    <tr key={trendDate}>
                      <td>{trendDate}</td>
                      <td>{money(trend.revenue)}</td>
                      <td>{trend.jobs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div> : null}
        </>
      )}

      {view === "daily" ? (
        <>
      <div className="ops-card ops-jobs-filter-card" id="jobs-find">
        <form className="ops-jobs-filter-toolbar" method="get">
          <input type="hidden" name="date" value={date} />
          {view !== "daily" ? <input type="hidden" name="view" value={view} /> : null}
          <label className="ops-jobs-search-field" htmlFor="jobs-search">
            <span className="ops-visually-hidden">Find a job</span>
            <input id="jobs-search" name="q" defaultValue={filters.q} placeholder="Find a job, customer, phone, or address" />
          </label>
          <button type="submit" className="ops-jobs-search-button">Search</button>
          <details className="ops-jobs-filter-menu" open={hasActiveFilters && activeFilterCount > (filters.q ? 1 : 0)}>
            <summary>
              Filters
              {activeFilterCount > (filters.q ? 1 : 0) ? <span>{activeFilterCount - (filters.q ? 1 : 0)}</span> : null}
            </summary>
            <div className="ops-jobs-filters">
          <div>
            <label htmlFor="jobs-territory">Territory</label>
            <select id="jobs-territory" name="territory" defaultValue={filters.territory}>
              <option value="">All territories</option>
              {allTerritories.map((territory) => (
                <option key={territory} value={territory}>{territory}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="jobs-status">Status</label>
            <select id="jobs-status" name="status" defaultValue={filters.status}>
              <option value="">All statuses</option>
              {allStatuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="jobs-payment">Payment Type</label>
            <select id="jobs-payment" name="paymentType" defaultValue={filters.paymentType}>
              <option value="">All payment types</option>
              {allPaymentTypes.map((paymentType) => (
                <option key={paymentType} value={paymentType}>{paymentType}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="jobs-truck">Truck</label>
            <select id="jobs-truck" name="truck" defaultValue={filters.truck}>
              <option value="">All trucks</option>
              {allTrucks.map((truck) => (
                <option key={truck} value={truck}>{truck}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="jobs-site-time">Site Time</label>
            <select id="jobs-site-time" name="siteTime" defaultValue={filters.siteTime}>
              <option value="">All appointments</option>
              <option value="overHour">Jobs over one hour</option>
            </select>
          </div>
          <div className="ops-jobs-filter-actions">
            <button type="submit" className="ops-refresh-button">Apply</button>
            <a className="ops-reset-filter" href={buildJobsHref({ date, view, workspace })}>Clear all</a>
          </div>
            </div>
          </details>
        </form>
        {hasActiveFilters ? (
          <div className="ops-jobs-active-filters" aria-label="Active filters">
            <span>Showing {filterCount} of {jobs.length}</span>
            {filters.q ? <a href={buildJobsHref({ date, view, workspace, ...filters, q: "" })}>Search: {filters.q} ×</a> : null}
            {filters.territory ? <a href={buildJobsHref({ date, view, workspace, ...filters, territory: "" })}>{filters.territory} ×</a> : null}
            {filters.status ? <a href={buildJobsHref({ date, view, workspace, ...filters, status: "" })}>{filters.status} ×</a> : null}
            {filters.paymentType ? <a href={buildJobsHref({ date, view, workspace, ...filters, paymentType: "" })}>{filters.paymentType} ×</a> : null}
            {filters.truck ? <a href={buildJobsHref({ date, view, workspace, ...filters, truck: "" })}>{filters.truck} ×</a> : null}
            {filters.siteTime ? <a href={buildJobsHref({ date, view, workspace, ...filters, siteTime: "" })}>Over one hour ×</a> : null}
          </div>
        ) : null}
      </div>

      <nav className="ops-jobs-workspace-jump" aria-label="Dispatch workspace views">
        <a href="#jobs-map">Map &amp; board</a>
        <a href="#jobs-schedule">Appointment queue <small>{filterCount}</small></a>
      </nav>

      <JobsMap date={date} jobs={mapPoints} scheduleView trucks={routeTrucks} truckLocations={mapTrucks} />

      <div className="ops-card" id="jobs-schedule">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Appointment queue</div>
            <div className="ops-muted">
              {scheduleCopy.possessive} jobs, grouped by territory and ordered by appointment time.
            </div>
          </div>
          <div className="ops-job-count-pill">{filterCount} appointments</div>
        </div>

        <div
          className="ops-selected-appointment-slot"
          id="jobs-selected-appointment-slot"
          aria-live="polite"
        />

        {groupedJobs.length > 1 ? (
          <nav className="ops-territory-jump" aria-label="Jump to territory">
            <span>Jump to</span>
            {groupedJobs.map(([territory, territoryJobs]) => (
              <a href={`#${territoryAnchorId(territory)}`} key={territory}>
                {territory} <small>{territoryJobs.length}</small>
              </a>
            ))}
          </nav>
        ) : null}

        <div className="ops-territory-jobs">
          {groupedJobs.map(([territory, territoryJobs]) => (
            <section className="ops-territory-section" id={territoryAnchorId(territory)} key={territory}>
              <div className={`ops-territory-header ${territoryToneClass(territory)}`}>
                <div>
                  <div className="ops-territory-label">Territory</div>
                  <div className="ops-territory-title">{territory}</div>
                  <div className="ops-muted">
                    {territoryJobs.length} appointment{territoryJobs.length === 1 ? "" : "s"} · ordered by scheduled time
                  </div>
                </div>

                <div className="ops-territory-total">
                  <strong>{money(territoryTotal(territoryJobs))}</strong>
                  <small>completed revenue</small>
                </div>
              </div>

              {groupJobsBySchedule(territoryJobs.filter((job) => timedJobs(job))).map(([scheduleGroup, scheduledJobs]) => {
                if (!scheduledJobs.length) return null;

                return (
                  <div className="ops-status-group" key={`${territory}-${scheduleGroup}`}>
                    <div className="ops-status-group-header">
                      <div className="ops-status-group-title">{scheduleGroup}</div>
                      <div className="ops-status-group-count">{scheduledJobs.length}</div>
                    </div>

                    <div className="ops-appointment-card-list">
                      {scheduledJobs.map((job, index) => {
                        const siteTime = siteTimeLookupKeys(job)
                          .map((key) => siteTimeByKey.get(key))
                          .find(Boolean);
                        const punctuality = appointmentPunctuality(job, siteTime);
                        const visitedTrucks = Array.from(new Set([
                          ...siteTimeVisitedTrucks(siteTime),
                          ...(gpsVisitedTrucksByJobKey.get(jobKey(job)) || []),
                        ]));
                        const visitedButNotClosed = appointmentVisitedButNotClosed(job, visitedTrucks);
                        const jobExceptionsForCard = getJobExceptions(job);
                        const topException = jobExceptionsForCard[0];
                        const jobDate = job.sourceDate || date;
                        const callAheadJobKey = jobRouteAssignmentKey(job);
                        const callAheadStatus = callAheadStatuses.get(jobCallAheadLookupKey(jobDate, callAheadJobKey));
                        const exceptionSeverity = jobExceptionsForCard.some((exception) => exception.severity === "critical")
                          ? "critical"
                          : jobExceptionsForCard.some((exception) => exception.severity === "warning")
                            ? "warning"
                            : jobExceptionsForCard.length
                              ? "info"
                              : "";

                        return (
                          <JobCallAheadCard
                            date={jobDate}
                            jobKey={callAheadJobKey}
                            initialStatus={callAheadStatus}
                            articleId={appointmentCardId(job)}
                            isCanceled={statusBucket(job) === "Canceled"}
                            trucksOnSite={date === chicagoDateKey()
                              ? mapPoints.find((point) => point.detailId === appointmentCardId(job))?.trucksOnSite || []
                              : []}
                            key={`${territory}-${scheduleGroup}-${job.jkNumber}-${index}`}
                          >
                            <div className="ops-appointment-card-topline">
                              <div className="ops-appointment-card-identity">
                                <div className="ops-appointment-card-reference">
                                  <div className="ops-appointment-card-reference-row">
                                    <span className="ops-appointment-card-time">{safeText(job.appointmentTime)}</span>
                                    {punctuality ? (
                                      <span className={`ops-punctuality-badge ${punctuality.tone}`}>{punctuality.label}</span>
                                    ) : null}
                                    {job.appointmentUrl ? (
                                      <a
                                        className="ops-jk-number clickable"
                                        href={job.appointmentUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        {safeText(job.jkNumber)}
                                      </a>
                                    ) : (
                                      <span className="ops-jk-number">{safeText(job.jkNumber)}</span>
                                    )}
                                  </div>
                                  {job.appointmentUrl ? (
                                    <a
                                      className="ops-appointment-card-customer ops-appointment-link"
                                      href={job.appointmentUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {safeText(job.customerName)}
                                    </a>
                                  ) : (
                                    <div className="ops-appointment-card-customer">{safeText(job.customerName)}</div>
                                  )}
                                  {job.address && job.address !== "—" ? (
                                    <a
                                      className="ops-appointment-card-address"
                                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {job.address}
                                    </a>
                                  ) : (
                                    <div className="ops-appointment-card-address">Address unavailable</div>
                                  )}
                                  <div className="ops-appointment-card-crew">
                                    <span className="ops-physical-truck-badge">
                                      {siteTime?.trucks?.[0]?.truck || (job.truck !== "—" ? job.truck : "Unassigned truck")}
                                    </span>
                                    <span className="ops-appointment-card-driver">{safeText(job.driverName || job.driver)}</span>
                                    <span className="ops-appointment-card-navigator">{safeText(job.navigatorName || job.navigator)}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="ops-appointment-card-outcome">
                                <span className={`ops-status-tag compact ${statusBadgeClass(statusBucket(job))}`}>{cardStatusLabel(job)}</span>
                                {jobMissingPhotos(job) ? (
                                  <span className="ops-job-photo-badge missing" title="JunkWare was checked and no closeout photos were found.">
                                    Photos missing
                                  </span>
                                ) : job.photos.length ? (
                                  <span className="ops-job-photo-badge complete">{job.photos.length} photo{job.photos.length === 1 ? "" : "s"}</span>
                                ) : null}
                                {visitedButNotClosed ? (
                                  <span
                                    className="ops-visited-unclosed-badge"
                                    title="Linxup shows a crew visit, but this appointment is not closed out in JunkWare."
                                  >
                                    <b aria-hidden="true">?</b>
                                    Visited · not closed
                                  </span>
                                ) : null}
                                <div className="ops-appointment-card-amount">
                                  <strong className={`ops-appointment-card-revenue${statusBucket(job) === "Open / Scheduled" && job.paymentAmount > 0 ? " quoted" : ""}${job.paymentAmount > 0 || statusBucket(job) === "Completed" || statusBucket(job) === "Estimate" ? "" : " unavailable"}`}>
                                    {job.paymentAmount > 0 || statusBucket(job) === "Completed" || statusBucket(job) === "Estimate" ? money(job.paymentAmount) : "$--.--"}
                                  </strong>
                                </div>
                                <span className={job.paymentType !== "—" ? paymentClass(job.paymentType) : "ops-outcome-unavailable"}>
                                  {job.paymentType !== "—" ? job.paymentType : "Payment not selected"}
                                </span>
                                {jobExceptionsForCard.length > 0 && (
                                  <a
                                    className={`ops-job-exception-badge ${exceptionSeverity}`}
                                    href={topException?.href || `#${appointmentCardId(job)}`}
                                    title={jobExceptionsForCard.map((exception) => `${exception.title}: ${exception.reason}`).join(" · ")}
                                  >
                                    {topException?.title || (exceptionSeverity === "critical" ? "Critical exception" : exceptionSeverity === "warning" ? "Warning" : "Info")}
                                    {jobExceptionsForCard.length > 1 ? ` +${jobExceptionsForCard.length - 1}` : ""}
                                  </a>
                                )}
                              </div>
                            </div>

                            <JobContextDetails job={job} />

                            <JobPhotoDetails job={job} />

                            {job.tipAmount > 0 ? <div className="ops-appointment-card-tip">
                              <span className="ops-appointment-card-tip-label">TIPS</span>
                              <strong className="ops-appointment-card-tip-value">{money(job.tipAmount || 0)}</strong>
                            </div> : null}

                            <JobCloseoutDetails job={job} />

                            <JobCloseoutEditor appointmentId={job.appointmentId} appointmentUrl={job.appointmentUrl} initialStatus={job.status} />

                            <details className="ops-appointment-gps-details">
                              <summary>GPS and site time</summary>
                              <div className="ops-appointment-site-time">
                              <div className="ops-appointment-site-time-label">TRUCK SITE TIME</div>
                              {siteTime?.trucks?.length ? (
                                <div className="ops-appointment-site-time-list">
                                  {siteTime.trucks.map((truck, truckIndex) => {
                                    const durationMinutes = siteTimeTruckDurationMinutes(truck);
                                    const durationText = siteDurationLabel(durationMinutes);
                                    const durationClass = siteDurationClass(durationMinutes);
                                    const isOngoing = Boolean(truck.arrival && !truck.departure);
                                    const summaryWindow = isOngoing
                                      ? "On Site"
                                      : truck.arrival && truck.departure
                                        ? `${siteTimeClock(truck.arrival)}–${siteTimeClock(truck.departure)}`
                                        : siteTimeQuality(truck);
                                    const summaryDuration = durationMinutes != null ? ` · ${durationText}` : "";
                                    const statusText =
                                      truck.state === "Confirmed visit"
                                        ? "Verified"
                                        : truck.state === "Probable visit"
                                          ? "Probable"
                                          : truck.state;

                                    return (
                                      <div className="ops-site-time-truck" key={`${siteTime.appointmentId}-${truck.truck}-${truckIndex}`}>
                                        <div className="ops-site-time-truck-summary">
                                          <span className="ops-site-time-truck-name">{truck.truck}</span>
                                          <span className="ops-site-time-truck-window">{summaryWindow}</span>
                                          {durationMinutes != null ? (
                                            <span className={`ops-site-time-truck-duration${durationClass}`}>{summaryDuration.replace(/^ · /, "")}</span>
                                          ) : null}
                                          <span className="ops-site-time-truck-status">{statusText}</span>
                                        </div>

                                        {truck.visitCount > 1 || truck.intervals.length > 1 ? (
                                          <details className="ops-site-time-visits">
                                            <summary>Visit details</summary>
                                            <div className="ops-site-time-visit-list">
                                              {truck.intervals.map((interval, intervalIndex) => {
                                                const intervalDuration = siteTimeTruckDurationMinutes(interval);
                                                return (
                                                  <div className="ops-site-time-visit" key={`${siteTime.appointmentId}-${truck.truck}-visit-${intervalIndex}`}>
                                                    <span>Visit {intervalIndex + 1}</span>
                                                    <strong>
                                                      {siteTimeClock(interval.arrival)}–{siteTimeClock(interval.departure)}
                                                    </strong>
                                                    <em className={siteDurationClass(intervalDuration)}>
                                                      {siteDurationLabel(intervalDuration)}
                                                    </em>
                                                  </div>
                                                );
                                              })}
                                              <div className="ops-site-time-visit ops-site-time-total">
                                                <span>Total</span>
                                                <strong>—</strong>
                                                <em className={siteDurationClass(durationMinutes)}>{siteDurationLabel(durationMinutes)}</em>
                                              </div>
                                            </div>
                                          </details>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="ops-site-time-unavailable">GPS data unavailable</div>
                              )}
                              </div>
                            </details>

                            <details className="ops-appointment-more-details">
                              <summary>More details</summary>
                              <div className="ops-appointment-detail-grid">
                                <div>
                                  <span>Phone</span>
                                  <strong>{safeText(job.phone)}</strong>
                                </div>
                                <div>
                                  <span>Email</span>
                                  <strong>
                                    {job.customerEmail === "—" ? "Unavailable" : (
                                      <a href={`mailto:${job.customerEmail}`}>{job.customerEmail}</a>
                                    )}
                                  </strong>
                                </div>
                                <div>
                                  <span>Truck</span>
                                  <strong>{safeText(job.assignedTruck || job.truck)}</strong>
                                </div>
                                <div>
                                  <span>Driver</span>
                                  <strong>{safeText(job.driverName || job.driver)}</strong>
                                </div>
                                <div>
                                  <span>Navigator</span>
                                  <strong>{safeText(job.navigatorName || job.navigator)}</strong>
                                </div>
                                <div>
                                  <span>Additional crew</span>
                                  <strong>
                                    {job.additionalCrew && job.additionalCrew.length > 0
                                      ? job.additionalCrew.join(", ")
                                      : "Unavailable"}
                                  </strong>
                                </div>
                                <div>
                                  <span>Crew source</span>
                                  <strong>{safeText(job.crewAssignmentSource || "Unavailable")}</strong>
                                </div>
                                <div>
                                  <span>Crew status</span>
                                  <strong>{safeText(job.crewAssignmentStatus || "Unavailable")}</strong>
                                </div>
                                <div>
                                  <span>Payment method</span>
                                  <strong>{job.paymentType === "—" ? "Unavailable" : job.paymentType}</strong>
                                </div>
                                <div>
                                  <span>{appointmentAmountLabel(job)}</span>
                                  <strong>{money(job.paymentAmount)}</strong>
                                </div>
                                <div>
                                  <span>Appointment type</span>
                                  <strong>{safeText(job.appointmentType)}</strong>
                                </div>
                                <div>
                                  <span>Status</span>
                                  <strong>{safeText(job.status)}</strong>
                                </div>
                              </div>
                            </details>
                          </JobCallAheadCard>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {territoryJobs.filter((job) => !timedJobs(job)).length ? (
                <div className="ops-status-group">
                  <div className="ops-status-group-header">
                    <div className="ops-status-group-title">Unscheduled / Time unavailable</div>
                    <div className="ops-status-group-count">{territoryJobs.filter((job) => !timedJobs(job)).length}</div>
                  </div>

                  <div className="ops-appointment-card-list">
                    {territoryJobs.filter((job) => !timedJobs(job)).sort(compareJobSchedule).map((job, index) => {
                      const siteTime = siteTimeLookupKeys(job)
                        .map((key) => siteTimeByKey.get(key))
                        .find(Boolean);
                      const punctuality = appointmentPunctuality(job, siteTime);
                      const visitedTrucks = Array.from(new Set([
                        ...siteTimeVisitedTrucks(siteTime),
                        ...(gpsVisitedTrucksByJobKey.get(jobKey(job)) || []),
                      ]));
                      const visitedButNotClosed = appointmentVisitedButNotClosed(job, visitedTrucks);
                      const jobExceptionsForCard = getJobExceptions(job);
                      const topException = jobExceptionsForCard[0];
                      const jobDate = job.sourceDate || date;
                      const callAheadJobKey = jobRouteAssignmentKey(job);
                      const callAheadStatus = callAheadStatuses.get(jobCallAheadLookupKey(jobDate, callAheadJobKey));
                      const exceptionSeverity = jobExceptionsForCard.some((exception) => exception.severity === "critical")
                        ? "critical"
                        : jobExceptionsForCard.some((exception) => exception.severity === "warning")
                          ? "warning"
                          : jobExceptionsForCard.length
                            ? "info"
                            : "";

                      return (
                        <JobCallAheadCard
                          date={jobDate}
                          jobKey={callAheadJobKey}
                          initialStatus={callAheadStatus}
                          articleId={appointmentCardId(job)}
                          isCanceled={statusBucket(job) === "Canceled"}
                          trucksOnSite={date === chicagoDateKey()
                            ? mapPoints.find((point) => point.detailId === appointmentCardId(job))?.trucksOnSite || []
                            : []}
                          key={`${territory}-unscheduled-${job.jkNumber}-${index}`}
                        >
                          <div className="ops-appointment-card-topline">
                            <div className="ops-appointment-card-identity">
                              <div className="ops-appointment-card-reference">
                                <div className="ops-appointment-card-reference-row">
                                  <span className="ops-appointment-card-time">{safeText(job.appointmentTime)}</span>
                                  {punctuality ? (
                                    <span className={`ops-punctuality-badge ${punctuality.tone}`}>{punctuality.label}</span>
                                  ) : null}
                                  {job.appointmentUrl ? (
                                    <a
                                      className="ops-jk-number clickable"
                                      href={job.appointmentUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      {safeText(job.jkNumber)}
                                    </a>
                                  ) : (
                                    <span className="ops-jk-number">{safeText(job.jkNumber)}</span>
                                  )}
                                </div>
                                {job.appointmentUrl ? (
                                  <a
                                    className="ops-appointment-card-customer ops-appointment-link"
                                    href={job.appointmentUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {safeText(job.customerName)}
                                  </a>
                                ) : (
                                  <div className="ops-appointment-card-customer">{safeText(job.customerName)}</div>
                                )}
                                {job.address && job.address !== "—" ? (
                                  <a
                                    className="ops-appointment-card-address"
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {job.address}
                                  </a>
                                ) : (
                                  <div className="ops-appointment-card-address">Address unavailable</div>
                                )}
                                <div className="ops-appointment-card-crew">
                                  <span className="ops-physical-truck-badge">
                                    {siteTime?.trucks?.[0]?.truck || (job.truck !== "—" ? job.truck : "Unassigned truck")}
                                  </span>
                                  <span className="ops-appointment-card-driver">{safeText(job.driverName || job.driver)}</span>
                                  <span className="ops-appointment-card-navigator">{safeText(job.navigatorName || job.navigator)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="ops-appointment-card-outcome">
                              <span className={`ops-status-tag compact ${statusBadgeClass(statusBucket(job))}`}>{cardStatusLabel(job)}</span>
                              {jobMissingPhotos(job) ? (
                                <span className="ops-job-photo-badge missing" title="JunkWare was checked and no closeout photos were found.">
                                  Photos missing
                                </span>
                              ) : job.photos.length ? (
                                <span className="ops-job-photo-badge complete">{job.photos.length} photo{job.photos.length === 1 ? "" : "s"}</span>
                              ) : null}
                              {visitedButNotClosed ? (
                                <span
                                  className="ops-visited-unclosed-badge"
                                  title="Linxup shows a crew visit, but this appointment is not closed out in JunkWare."
                                >
                                  <b aria-hidden="true">?</b>
                                  Visited · not closed
                                </span>
                              ) : null}
                              <div className="ops-appointment-card-amount">
                                <strong className={`ops-appointment-card-revenue${statusBucket(job) === "Open / Scheduled" && job.paymentAmount > 0 ? " quoted" : ""}${job.paymentAmount > 0 || statusBucket(job) === "Completed" || statusBucket(job) === "Estimate" ? "" : " unavailable"}`}>
                                  {job.paymentAmount > 0 || statusBucket(job) === "Completed" || statusBucket(job) === "Estimate" ? money(job.paymentAmount) : "$--.--"}
                                </strong>
                              </div>
                              <span className={job.paymentType !== "—" ? paymentClass(job.paymentType) : "ops-outcome-unavailable"}>
                                {job.paymentType !== "—" ? job.paymentType : "Payment not selected"}
                              </span>
                              {jobExceptionsForCard.length > 0 && (
                                <a
                                  className={`ops-job-exception-badge ${exceptionSeverity}`}
                                  href={topException?.href || `#${appointmentCardId(job)}`}
                                  title={jobExceptionsForCard.map((exception) => `${exception.title}: ${exception.reason}`).join(" · ")}
                                >
                                  {topException?.title || (exceptionSeverity === "critical" ? "Critical exception" : exceptionSeverity === "warning" ? "Warning" : "Info")}
                                  {jobExceptionsForCard.length > 1 ? ` +${jobExceptionsForCard.length - 1}` : ""}
                                </a>
                              )}
                            </div>
                          </div>

                          <JobContextDetails job={job} />

                          <JobPhotoDetails job={job} />

                          {job.tipAmount > 0 ? <div className="ops-appointment-card-tip">
                            <span className="ops-appointment-card-tip-label">TIPS</span>
                            <strong className="ops-appointment-card-tip-value">{money(job.tipAmount || 0)}</strong>
                          </div> : null}

                          <JobCloseoutDetails job={job} />

                          <JobCloseoutEditor appointmentId={job.appointmentId} appointmentUrl={job.appointmentUrl} initialStatus={job.status} />

                          <details className="ops-appointment-gps-details">
                            <summary>GPS and site time</summary>
                            <div className="ops-appointment-site-time">
                            <div className="ops-appointment-site-time-label">TRUCK SITE TIME</div>
                            {siteTime?.trucks?.length ? (
                              <div className="ops-appointment-site-time-list">
                                {siteTime.trucks.map((truck, truckIndex) => {
                                  const durationMinutes = siteTimeTruckDurationMinutes(truck);
                                  const durationText = siteDurationLabel(durationMinutes);
                                  const durationClass = siteDurationClass(durationMinutes);
                                  const isOngoing = Boolean(truck.arrival && !truck.departure);
                                  const summaryWindow = isOngoing
                                    ? "On Site"
                                    : truck.arrival && truck.departure
                                      ? `${siteTimeClock(truck.arrival)}–${siteTimeClock(truck.departure)}`
                                      : siteTimeQuality(truck);
                                  const summaryDuration = durationMinutes != null ? ` · ${durationText}` : "";
                                  const statusText =
                                    truck.state === "Confirmed visit"
                                      ? "Verified"
                                      : truck.state === "Probable visit"
                                        ? "Probable"
                                        : truck.state;

                                  return (
                                    <div className="ops-site-time-truck" key={`${siteTime.appointmentId}-${truck.truck}-${truckIndex}`}>
                                      <div className="ops-site-time-truck-summary">
                                        <span className="ops-site-time-truck-name">{truck.truck}</span>
                                        <span className="ops-site-time-truck-window">{summaryWindow}</span>
                                        {durationMinutes != null ? (
                                          <span className={`ops-site-time-truck-duration${durationClass}`}>{summaryDuration.replace(/^ · /, "")}</span>
                                        ) : null}
                                        <span className="ops-site-time-truck-status">{statusText}</span>
                                      </div>

                                      {truck.visitCount > 1 || truck.intervals.length > 1 ? (
                                        <details className="ops-site-time-visits">
                                          <summary>Visit details</summary>
                                          <div className="ops-site-time-visit-list">
                                            {truck.intervals.map((interval, intervalIndex) => {
                                              const intervalDuration = siteTimeTruckDurationMinutes(interval);
                                              return (
                                                <div className="ops-site-time-visit" key={`${siteTime.appointmentId}-${truck.truck}-visit-${intervalIndex}`}>
                                                  <span>Visit {intervalIndex + 1}</span>
                                                  <strong>
                                                    {siteTimeClock(interval.arrival)}–{siteTimeClock(interval.departure)}
                                                  </strong>
                                                  <em className={siteDurationClass(intervalDuration)}>
                                                    {siteDurationLabel(intervalDuration)}
                                                  </em>
                                                </div>
                                              );
                                            })}
                                            <div className="ops-site-time-visit ops-site-time-total">
                                              <span>Total</span>
                                              <strong>—</strong>
                                              <em className={siteDurationClass(durationMinutes)}>{siteDurationLabel(durationMinutes)}</em>
                                            </div>
                                          </div>
                                        </details>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="ops-site-time-unavailable">GPS data unavailable</div>
                            )}
                            </div>
                          </details>

                          <details className="ops-appointment-more-details">
                            <summary>More details</summary>
                            <div className="ops-appointment-detail-grid">
                              <div>
                                <span>Phone</span>
                                <strong>{safeText(job.phone)}</strong>
                              </div>
                              <div>
                                <span>Email</span>
                                <strong>
                                  {job.customerEmail === "—" ? "Unavailable" : (
                                    <a href={`mailto:${job.customerEmail}`}>{job.customerEmail}</a>
                                  )}
                                </strong>
                              </div>
                              <div>
                                <span>Truck</span>
                                <strong>{safeText(job.assignedTruck || job.truck)}</strong>
                              </div>
                              <div>
                                <span>Driver</span>
                                <strong>{safeText(job.driverName || job.driver)}</strong>
                              </div>
                              <div>
                                <span>Navigator</span>
                                <strong>{safeText(job.navigatorName || job.navigator)}</strong>
                              </div>
                              <div>
                                <span>Additional crew</span>
                                <strong>
                                  {job.additionalCrew && job.additionalCrew.length > 0
                                    ? job.additionalCrew.join(", ")
                                    : "Unavailable"}
                                </strong>
                              </div>
                              <div>
                                <span>Crew source</span>
                                <strong>{safeText(job.crewAssignmentSource || "Unavailable")}</strong>
                              </div>
                              <div>
                                <span>Crew status</span>
                                <strong>{safeText(job.crewAssignmentStatus || "Unavailable")}</strong>
                              </div>
                              <div>
                                <span>Payment method</span>
                                <strong>{job.paymentType === "—" ? "Unavailable" : job.paymentType}</strong>
                              </div>
                              <div>
                                <span>{appointmentAmountLabel(job)}</span>
                                <strong>{money(job.paymentAmount)}</strong>
                              </div>
                              <div>
                                <span>Appointment type</span>
                                <strong>{safeText(job.appointmentType)}</strong>
                              </div>
                              <div>
                                <span>Status</span>
                                <strong>{safeText(job.status)}</strong>
                              </div>
                            </div>
                          </details>
                        </JobCallAheadCard>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          ))}

          {jobs.length === 0 && (
            <div className="ops-empty-state">
              No appointments are currently published for this date. The schedule will appear here automatically when JunkWare has appointments available.
            </div>
          )}

          {jobs.length > 0 && (
            <div className="ops-job-total-row compact-total">
              <span>Completed Job Revenue</span>
              <strong>{money(collected)}</strong>
            </div>
          )}
        </div>
      </div>
        </>
      ) : null}
    </div>
  );
}
