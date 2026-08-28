import type { JobsMapPoint, JobsMapTruck } from "@/components/JobsMap";
import { buildFleetMapPayload, type FleetTruckMapRecord } from "@/lib/fleet-map";
import { jobRouteAssignmentKey } from "@/lib/job-route-key";
import { type AnyRecord, readMetrics } from "@/lib/opsData";

export type CommandScheduleStatusBucket =
  | "Canceled"
  | "Completed"
  | "Estimate"
  | "Open / Scheduled"
  | "Unclosed or Needs Attention";

export type CommandScheduleSummary = {
  scheduled: number;
  closed: number;
  completedJobs: number;
  closedEstimates: number;
  remaining: number;
};

function text(row: AnyRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function number(row: AnyRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(row?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  return value.split(/\r?\n|\s*;\s*/).map((item) => item.trim()).filter(Boolean);
}

function appointmentMinutes(value: string): [number | null, number | null] {
  const matches = Array.from(value.matchAll(/(\d{1,2}):(\d{2})\s*([ap]m)/gi));
  const minuteValue = (match: RegExpMatchArray | undefined) => {
    if (!match) return null;
    const hour = Number(match[1]) % 12 + (match[3].toLowerCase() === "pm" ? 12 : 0);
    return hour * 60 + Number(match[2]);
  };
  return [minuteValue(matches[0]), minuteValue(matches[1])];
}

function statusBucket(row: AnyRecord): CommandScheduleStatusBucket {
  const type = text(row, "appointment_type", "appointmentType").toLowerCase();
  const status = text(row, "job_status", "status").toLowerCase();
  if (status.includes("cancel")) return "Canceled";
  if (status.includes("unclosed") || status.includes("needs attention") || status.includes("attention")) {
    return "Unclosed or Needs Attention";
  }
  const closed = status.includes("complete") || status.includes("closed") || status.includes("paid");
  if (closed && type.includes("estimate")) return "Estimate";
  if (closed) return "Completed";
  if (status.includes("confirmed") || status.includes("open") || status.includes("schedule")) return "Open / Scheduled";
  return "Unclosed or Needs Attention";
}

/**
 * Counts the active schedule independently from production-job metrics.
 * A completed estimate is closed schedule work, but it must stay distinct
 * from a completed revenue job.
 */
export function summarizeCommandSchedule(
  jobs: Array<Pick<JobsMapPoint, "statusBucket">>,
): CommandScheduleSummary {
  const activeJobs = jobs.filter((job) => job.statusBucket !== "Canceled");
  const completedJobs = activeJobs.filter((job) => job.statusBucket === "Completed").length;
  const closedEstimates = activeJobs.filter((job) => job.statusBucket === "Estimate").length;
  const closed = completedJobs + closedEstimates;

  return {
    scheduled: activeJobs.length,
    closed,
    completedJobs,
    closedEstimates,
    remaining: activeJobs.length - closed,
  };
}

function appointmentUrl(row: AnyRecord, appointmentId: string): string {
  const direct = text(row, "appointment_url", "appt_url", "job_url", "junkware_url", "source_url", "url");
  if (/^https?:\/\//i.test(direct)) return direct;
  return /^\d{1,12}$/.test(appointmentId)
    ? `https://junkware.junk-king.com/franchise/appointment.aspx?id=${encodeURIComponent(appointmentId)}`
    : "";
}

function mapPoint(row: AnyRecord, index: number): JobsMapPoint {
  const appointmentId = text(row, "appt_id", "appointment_id", "appointmentId");
  const jkNumber = text(row, "job_id", "jk_number", "jkNumber") || "—";
  const customerName = text(row, "customer_name", "customerName") || "Customer";
  const address = text(row, "service_address", "address") || "—";
  const appointmentTime = text(row, "appointment_time", "appointmentTime") || "Time pending";
  const [appointmentStartMinutes, appointmentEndMinutes] = appointmentMinutes(appointmentTime);
  const truck = text(row, "assigned_truck", "truck") || "Virtual Truck";
  const visitedTruck = text(row, "truck_number");
  const hasVisit = Number(row?.visit_count || 0) > 0 || Boolean(text(row, "first_arrival", "arrival_at"));
  const firstArrival = text(row, "first_arrival", "arrival_at");
  const finalDeparture = text(row, "final_departure", "departure_at");
  const assignmentKey = jobRouteAssignmentKey({ appointmentId, jkNumber, customerName, appointmentTime, address });

  return {
    key: `${assignmentKey || jkNumber}:${index}`,
    detailId: `command-map-${appointmentId || jkNumber.replace(/[^a-z0-9]+/gi, "-")}-${index}`,
    assignmentKey,
    appointmentId,
    latitude: number(row, "lat", "latitude"),
    longitude: number(row, "lng", "longitude"),
    customerName,
    address,
    territory: text(row, "normalized_territory", "territory", "market") || "Unknown territory",
    appointmentTime,
    appointmentStartMinutes,
    appointmentEndMinutes,
    appointmentType: text(row, "appointment_type", "appointmentType") || "Job",
    phone: text(row, "customer_phone", "phone"),
    status: text(row, "job_status", "status") || "Needs attention",
    statusBucket: statusBucket(row),
    truckOnSite: Boolean(firstArrival && !finalDeparture),
    visitedTrucks: hasVisit && visitedTruck ? [visitedTruck] : [],
    truck,
    jkNumber,
    appointmentUrl: appointmentUrl(row, appointmentId),
    junkItems: stringList(row?.junk_items ?? row?.junkItems),
    appointmentNotes: stringList(row?.appointment_notes ?? row?.appointmentNotes)
      .filter((note) => !/^Appointment moved from\b/i.test(note)),
  };
}

function mapTruck(truck: FleetTruckMapRecord): JobsMapTruck {
  return {
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
    routePoints: truck.routePoints.map((point) => ({
      timestamp: point.timestamp,
      latitude: point.latitude,
      longitude: point.longitude,
    })),
    jobStops: truck.routeStops.filter((stop) => stop.kind === "At Job").map((stop) => ({
      label: stop.label,
      latitude: stop.latitude,
      longitude: stop.longitude,
      begin: stop.begin,
      end: stop.end,
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
  };
}

export function buildCommandMapData(date: string): {
  jobs: JobsMapPoint[];
  trucks: string[];
  truckLocations: JobsMapTruck[];
} {
  const metrics = readMetrics(date);
  const appointments = Array.isArray(metrics?.appointments) ? metrics.appointments as AnyRecord[] : [];
  const jobs = appointments.map(mapPoint);
  const trucks = Array.from(new Set(jobs.map((job) => job.truck).filter((truck) => truck && !/virtual|unassigned|unavailable|^—$/i.test(truck))))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const fleet = buildFleetMapPayload(date);
  const truckLocations = (fleet?.trucks || [])
    .filter((truck) => truck.hasCoordinates && Number.isFinite(truck.latitude) && Number.isFinite(truck.longitude))
    .map(mapTruck);

  return { jobs, trucks, truckLocations };
}
