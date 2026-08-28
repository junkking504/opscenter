"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import AppointmentCancelDialog, { type AppointmentCancelTarget } from "@/components/AppointmentCancelDialog";
import type { JobRouteProximityPayload, JobTruckProximity } from "@/lib/job-route-proximity";
import { buildJobRouteHistory } from "@/lib/job-route-history";
import { parseTruckNumberFromLabel } from "@/lib/linxup-truck-label";
import {
  dispatchMapCoverage,
  dispatchMapVerificationReason,
  hasVerifiedDispatchLocation,
} from "@/lib/dispatch-map-quality";

export type JobsMapPoint = {
  key: string;
  detailId: string;
  assignmentKey: string;
  appointmentId: string;
  latitude: number | null;
  longitude: number | null;
  customerName: string;
  address: string;
  territory: string;
  appointmentTime: string;
  appointmentStartMinutes: number | null;
  appointmentEndMinutes: number | null;
  appointmentType: string;
  phone: string;
  status: string;
  statusBucket: string;
  truckOnSite: boolean;
  visitedTrucks: string[];
  truck: string;
  jkNumber: string;
  appointmentUrl: string;
  junkItems: string[];
  appointmentNotes: string[];
  junkwareSyncStatus?: "pending" | "verified" | "manual_correction";
  junkwareSyncError?: string;
};

export type JobsMapTruck = {
  truck: string;
  latitude: number;
  longitude: number;
  status: string;
  freshness: string;
  lastGpsUpdate: string | null;
  driver: string;
  navigator: string;
  recentPoints: Array<{
    timestamp: string;
    latitude: number;
    longitude: number;
    continuousUntil?: string | null;
  }>;
  routePoints: Array<{
    timestamp: string;
    latitude: number;
    longitude: number;
  }>;
  jobStops: Array<{
    label: string;
    latitude: number;
    longitude: number;
    begin: string;
    end: string;
  }>;
  recentStops: Array<{
    latitude: number;
    longitude: number;
    begin: string;
    end: string;
  }>;
};

type JobsMapProps = {
  date: string;
  jobs: JobsMapPoint[];
  scheduleView: boolean;
  trucks: string[];
  truckLocations: JobsMapTruck[];
};

type LeafletModule = typeof import("leaflet");

type FleetLiveStatusPayload = {
  lastUpdatedAt: string | null;
  trucks: JobsMapTruck[];
};

const STREET_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const STREET_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const LINXUP_POLL_INTERVAL_MS = 30_000;
const LINXUP_SITE_RADIUS_METERS = 125;
const LINXUP_MINIMUM_DWELL_MS = 2 * 60_000;
const LINXUP_MAX_POINT_GAP_MS = 5 * 60_000;
const LINXUP_FRESHNESS_MS = 10 * 60_000;
const APPOINTMENT_SELECTION_EVENT = "ops:select-appointment";
const APPOINTMENT_ON_SITE_EVENT = "ops:appointment-on-site";
// Dispatch opens with every operating territory comfortably inside the narrow
// map pane. Territory shortcuts still focus an individual area.
const DEFAULT_DISPATCH_MAP_CENTER: [number, number] = [30.2, -91.05];
const DEFAULT_DISPATCH_MAP_ZOOM = 7;
const DEFAULT_DISPATCH_MAP_BOUNDS: [[number, number], [number, number]] = [
  [29.75, -92.35],
  [30.7, -89.75],
];
const DEFAULT_DISPATCH_MAP_PADDING: [number, number] = [48, 48];
const TRUCK_MARKER_PANE = "ops-truck-marker-pane";
const DISPATCH_TERRITORY_SHORTCUTS = [
  { label: "New Orleans", abbreviation: "NO", tone: "is-new-orleans", center: [29.95, -90.08] as [number, number] },
  { label: "Baton Rouge", abbreviation: "BR", tone: "is-baton-rouge", center: [30.45, -91.15] as [number, number] },
  { label: "Northshore", abbreviation: "NS", tone: "is-northshore", center: [30.45, -90.04] as [number, number] },
  { label: "Jefferson Parish", abbreviation: "JP", tone: "is-jefferson", center: [29.95, -90.18] as [number, number] },
  { label: "Westbank", abbreviation: "WB", tone: "is-westbank", center: [29.90, -90.17] as [number, number] },
  { label: "Lafayette", abbreviation: "LF", tone: "is-lafayette", center: [30.22, -92.02] as [number, number] },
] as const;
const DISPATCH_TERRITORY_ZOOM = 11;

function isLocated(job: JobsMapPoint): job is JobsMapPoint & { latitude: number; longitude: number } {
  return hasVerifiedDispatchLocation(job);
}

function isVirtualTruck(value: string): boolean {
  return !value || /virtual|unassigned|unavailable|needs assignment|^—$/i.test(value);
}

function isEastMetroJob(job: JobsMapPoint): boolean {
  // This is a Dispatch presentation zone, not a change to the appointment's
  // operating territory. New Orleans East and Chalmette are yellow on the
  // schedule so they are quickly distinguishable from central New Orleans.
  return /\b(?:new\s+orleans\s+east|chalmette)\b|\b701(?:26|27|28|29)\b|\b70043\b/i
    .test(`${job.address} ${job.territory}`);
}

function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function truckHasConfirmedDwellAtJob(
  job: JobsMapPoint & { latitude: number; longitude: number },
  truck: JobsMapTruck,
  now: number,
): boolean {
  const points = truck.recentPoints
    .map((point) => ({
      ...point,
      time: Date.parse(point.timestamp),
      continuousUntilTime: Date.parse(String(point.continuousUntil || "")),
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
    .sort((a, b) => a.time - b.time);
  const latest = points[points.length - 1];
  if (!latest || latest.time > now + 2 * 60_000 || now - latest.time > LINXUP_FRESHNESS_MS) return false;
  if (distanceMeters(latest, job) > LINXUP_SITE_RADIUS_METERS) return false;

  const trailingInside = [latest];
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const point = points[index];
    const newer = trailingInside[0];
    if (distanceMeters(point, job) > LINXUP_SITE_RADIUS_METERS) break;
    const continuousStopCoversGap = Number.isFinite(point.continuousUntilTime)
      && point.continuousUntilTime >= newer.time;
    if (newer.time - point.time > LINXUP_MAX_POINT_GAP_MS && !continuousStopCoversGap) break;
    trailingInside.unshift(point);
  }

  return trailingInside.length >= 2
    && latest.time - trailingInside[0].time >= LINXUP_MINIMUM_DWELL_MS;
}

export function anyTruckIsCurrentlyAtJob(job: JobsMapPoint, trucks: JobsMapTruck[], now = Date.now()): boolean {
  if (!isLocated(job)) return false;
  return trucks.some((truck) => truckIsCurrentlyAtJob(job, truck, now));
}

function truckIsCurrentlyAtJob(
  job: JobsMapPoint & { latitude: number; longitude: number },
  truck: JobsMapTruck,
  now: number,
): boolean {
  // A marker earns the on-site state only from fresh, continuous GPS dwell.
  // A historical visit or a single late point at the address is not proof that
  // the truck has remained there.
  return truckHasConfirmedDwellAtJob(job, truck, now);
}

function truckIsCurrentlyAtAnyJob(truck: JobsMapTruck, jobs: JobsMapPoint[], now: number): boolean {
  return jobs.some((job) => isLocated(job) && truckIsCurrentlyAtJob(job, truck, now));
}

function truckHasConfirmedVisitAtJob(
  job: JobsMapPoint & { latitude: number; longitude: number },
  truck: JobsMapTruck,
  now: number,
): boolean {
  if (truckHasConfirmedDwellAtJob(job, truck, now)) return true;
  return truck.recentStops.some((stop) => {
    if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) return false;
    if (distanceMeters(stop, job) > LINXUP_SITE_RADIUS_METERS) return false;
    const begin = Date.parse(stop.begin);
    const end = Date.parse(stop.end);
    return Number.isFinite(begin)
      && Number.isFinite(end)
      && end >= begin
      && end - begin >= LINXUP_MINIMUM_DWELL_MS;
  });
}

function trucksThatVisitedJob(job: JobsMapPoint, trucks: JobsMapTruck[], now = Date.now()): string[] {
  if (!isLocated(job)) return [];
  return trucks
    .filter((truck) => truckHasConfirmedVisitAtJob(job, truck, now))
    .map((truck) => truck.truck);
}

export function isClosedScheduleJob(job: Pick<JobsMapPoint, "statusBucket">): boolean {
  return job.statusBucket === "Completed" || job.statusBucket === "Estimate";
}

function territoryTone(job: JobsMapPoint): string {
  const territory = String(job.territory || "").toLowerCase();
  let tone = "is-unknown-territory";
  if (territory.includes("new orleans")) tone = "is-new-orleans";
  else if (territory.includes("jefferson")) tone = "is-jefferson";
  else if (territory.includes("westbank")) tone = "is-westbank";
  else if (territory.includes("northshore")) tone = "is-northshore";
  else if (territory.includes("baton rouge")) tone = "is-baton-rouge";
  else if (territory.includes("lafayette")) tone = "is-lafayette";
  const completed = isClosedScheduleJob(job);
  const canceled = job.statusBucket === "Canceled";
  const eastMetro = isEastMetroJob(job);
  const assignmentState = canceled
    ? " is-canceled"
    : isVirtualTruck(job.truck)
    ? " is-unassigned"
    : completed
      ? ""
      : " is-assigned-unfinished";
  return `${tone}${eastMetro ? " is-east-metro" : ""}${assignmentState}${completed ? " is-completed" : ""}`;
}

function clusterTerritoryTone(jobs: JobsMapPoint[]): string {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const tone = territoryTone(job).split(" ")[0];
    counts.set(tone, (counts.get(tone) || 0) + 1);
  }
  const territoryPriority = ["is-new-orleans", "is-jefferson", "is-westbank", "is-northshore", "is-baton-rouge", "is-lafayette", "is-unknown-territory"];
  return [...counts.entries()].sort(([firstTone, firstCount], [secondTone, secondCount]) =>
    secondCount - firstCount || territoryPriority.indexOf(firstTone) - territoryPriority.indexOf(secondTone),
  )[0]?.[0]
    || "is-unknown-territory";
}

function appointmentClusterArea(job: JobsMapPoint): string {
  const territory = String(job.territory || "").trim().toLowerCase();
  // Dispatch treats the contiguous New Orleans / Jefferson Parish footprint as
  // one area. Northshore and Baton Rouge remain distinct, even when their map
  // points are visually close at a low zoom.
  if (territory === "new orleans" || territory === "jefferson parish") return "new-orleans-jefferson";
  return territory || "unknown-territory";
}

function formatTravelTime(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "time unavailable";
  const rounded = Math.max(1, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function proximityText(proximity: JobTruckProximity): string {
  const stale = /stale|offline|historical/i.test(proximity.gpsFreshness);
  const prefix = proximity.source === "google_live_traffic" ? "" : "~";
  const timing = proximity.source === "google_live_traffic" ? "with traffic" : "estimated";
  return `${prefix}${Number(proximity.miles || 0).toFixed(1)} mi · ${formatTravelTime(proximity.travelMinutes)} ${timing}${stale ? " · stale GPS" : ""}`;
}

function routeTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function nearestTruck(
  jobKey: string,
  proximity: JobRouteProximityPayload | null,
): { truck: string; proximity: JobTruckProximity } | null {
  const distances = proximity?.distances?.[jobKey];
  if (!distances) return null;
  const available = Object.entries(distances)
    .filter((entry): entry is [string, JobTruckProximity] => entry[1]?.status === "available" && entry[1].miles != null)
    .sort((a, b) => Number(a[1].miles) - Number(b[1].miles));
  return available.length ? { truck: available[0][0], proximity: available[0][1] } : null;
}

function unavailableProximityText(jobKey: string, proximity: JobRouteProximityPayload | null): string {
  const distances = Object.values(proximity?.distances?.[jobKey] || {});
  if (!distances.length) return "Proximity has not been calculated for this job";
  if (distances.every((distance) => distance.status === "job_location_unavailable")) {
    return "Job location could not be verified";
  }
  if (distances.every((distance) => distance.status === "truck_gps_unavailable")) {
    return "No truck has a verified GPS position";
  }
  return "No current truck route is available";
}

function markerIcon(leaflet: LeafletModule, job: JobsMapPoint, selected: boolean) {
  const tone = territoryTone(job);
  const completed = job.statusBucket === "Completed";
  return leaflet.divIcon({
    className: "",
    html: `<span class="ops-jobs-map-pin ${tone}${selected ? " is-selected" : ""}"><i${completed ? ' class="ops-jobs-map-pin-check"' : ""}>${completed ? "✓" : ""}</i></span>`,
    iconSize: [24, 30],
    iconAnchor: [12, 28],
    tooltipAnchor: [0, -28],
  });
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truckIcon(leaflet: LeafletModule, truck: JobsMapTruck, selected: boolean, atJob: boolean) {
  const number = truck.truck.match(/(\d+)/)?.[1] || truck.truck;
  return leaflet.divIcon({
    className: "",
    html: `<span class="ops-jobs-truck-marker${atJob ? " is-at-job" : ""}${selected ? " is-selected" : ""}">
      <svg viewBox="0 0 28 18" aria-hidden="true"><path d="M2 3h14v10H2zM16 7h5l4 4v2h-9z"/><circle cx="7" cy="14" r="2.5"/><circle cx="21" cy="14" r="2.5"/></svg>
      <b>T${escapeHtml(number)}</b>
    </span>`,
    iconSize: [36, 22],
    iconAnchor: [18, 18],
    tooltipAnchor: [0, -18],
  });
}

type MapCluster<T> = {
  latitude: number;
  longitude: number;
  items: T[];
};

type VisibleTruckMarker = {
  truck: JobsMapTruck;
  latitude: number;
  longitude: number;
};

// Appointment locations can share a count marker at low zoom. The same screen
// proximity calculation lets individual truck icons fan apart without turning
// them into a truck-area circle.
function clusterVisibleMapItems<T>(
  map: any,
  items: T[],
  coordinates: (item: T) => { latitude: number; longitude: number },
  minimumPixelDistance = 48,
): MapCluster<T>[] {
  const clusters: MapCluster<T>[] = [];

  for (const item of items) {
    const position = coordinates(item);
    const point = map.latLngToLayerPoint([position.latitude, position.longitude]);
    const match = clusters.find((cluster) => {
      const clusterPoint = map.latLngToLayerPoint([cluster.latitude, cluster.longitude]);
      return point.distanceTo(clusterPoint) < minimumPixelDistance;
    });
    if (match) match.items.push(item);
    else clusters.push({ ...position, items: [item] });
  }

  return clusters;
}

function spreadLiveTruckMarkers(map: any, trucks: JobsMapTruck[]): VisibleTruckMarker[] {
  return clusterVisibleMapItems(map, trucks, (truck) => truck, 48)
    .flatMap((group) => group.items.map((truck, index) => {
      if (group.items.length === 1) {
        return { truck, latitude: truck.latitude, longitude: truck.longitude };
      }

      const point = map.latLngToLayerPoint([truck.latitude, truck.longitude]);
      const angle = -Math.PI / 2 + (index * 2 * Math.PI / group.items.length);
      const radius = 30;
      const visiblePosition = map.layerPointToLatLng([
        point.x + Math.cos(angle) * radius,
        point.y + Math.sin(angle) * radius,
      ]);
      return {
        truck,
        latitude: visiblePosition.lat,
        longitude: visiblePosition.lng,
      };
    }));
}

function appointmentClusterIcon(leaflet: LeafletModule, count: number, tone: string) {
  return leaflet.divIcon({
    className: "",
    html: `<span class="ops-map-cluster is-appointments ${tone}"><b>${count}</b><small>jobs</small></span>`,
    iconSize: [46, 46],
    iconAnchor: [23, 23],
    popupAnchor: [0, -22],
  });
}

function scheduleSort(a: JobsMapPoint, b: JobsMapPoint): number {
  const aTime = a.appointmentStartMinutes ?? Number.MAX_SAFE_INTEGER;
  const bTime = b.appointmentStartMinutes ?? Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  return a.customerName.localeCompare(b.customerName, undefined, { sensitivity: "base" });
}

type ScheduleColumn = {
  key: string;
  label: string;
  virtual: boolean;
  assignment: string;
};

type ScheduleTimeOverride = {
  appointmentTime: string;
  appointmentStartMinutes: number;
  appointmentEndMinutes: number;
};

type ScheduleDragGesture = {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
};

const SCHEDULE_TRUCK_COLUMN_WIDTH = 72;

type ScheduleJobState = "completed" | "canceled" | "on-site" | "visited-unclosed" | "waiting";

export function isVisitedUnclosedScheduleJob(
  job: Pick<JobsMapPoint, "statusBucket" | "visitedTrucks">,
): boolean {
  return job.statusBucket !== "Completed"
    && job.statusBucket !== "Estimate"
    && job.statusBucket !== "Canceled"
    && job.visitedTrucks.length > 0;
}

function scheduleJobState(job: JobsMapPoint): { state: ScheduleJobState; label: string } {
  if (job.statusBucket === "Canceled") {
    return { state: "canceled", label: job.status || "Canceled" };
  }
  if (isClosedScheduleJob(job)) {
    return { state: "completed", label: job.statusBucket === "Estimate" ? "Closed estimate" : "Completed" };
  }
  if (job.truckOnSite) return { state: "on-site", label: "Truck on location" };
  if (isVisitedUnclosedScheduleJob(job)) {
    return { state: "visited-unclosed", label: "Krewe visited · appointment not closed out" };
  }
  return { state: "waiting", label: "Not completed · truck not on location" };
}

function ScheduleJobStateIcon({ job }: { job: JobsMapPoint }) {
  const status = scheduleJobState(job);
  if (status.state === "on-site") {
    return (
      <span className="ops-jobs-map-board-state is-on-site" title={status.label} aria-hidden="true" />
    );
  }
  if (status.state === "visited-unclosed") {
    return (
      <span className="ops-jobs-map-board-state is-visited-unclosed" title={status.label} aria-hidden="true">
        ?
      </span>
    );
  }
  if (status.state === "canceled") {
    return (
      <span className="ops-jobs-map-board-state is-canceled" title={status.label} aria-hidden="true">
        ×
      </span>
    );
  }
  if (status.state !== "completed") return null;
  return (
    <span className="ops-jobs-map-board-state is-completed" title={status.label} aria-hidden="true">
      ✓
    </span>
  );
}

function hasJunkwareSyncFailure(job: JobsMapPoint): boolean {
  return job.junkwareSyncStatus === "pending" || job.junkwareSyncStatus === "manual_correction";
}

function junkwareSyncLabel(job: JobsMapPoint): string {
  if (job.junkwareSyncStatus === "manual_correction") return "JunkWare sync needs manual correction";
  return job.junkwareSyncError
    ? "JunkWare sync failed — retry pending"
    : "JunkWare sync pending";
}

function chicagoScheduleClock(now = new Date()): { date: string; minutes: number; label: string; timestamp: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const normalized = ((hour % 24) + 24) % 24;
  const period = normalized >= 12 ? "PM" : "AM";
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: normalized * 60 + minute,
    label: `${normalized % 12 || 12}:${String(minute).padStart(2, "0")} ${period}`,
    timestamp: now.getTime(),
  };
}

function physicalTruckColumn(value: string): ScheduleColumn | null {
  if (isVirtualTruck(value)) return null;
  const match = value.match(/truck\s*#?\s*(\d+)/i);
  if (match) return { key: `truck-${match[1]}`, label: `T${match[1]}`, virtual: false, assignment: `Truck ${match[1]}` };
  const compact = value.replace(/[^a-z0-9]+/gi, "").slice(0, 3).toUpperCase();
  return compact ? { key: `truck-${compact.toLowerCase()}`, label: compact, virtual: false, assignment: value } : null;
}

function buildScheduleBoard(jobs: JobsMapPoint[], trucks: string[]) {
  const physicalColumns = new Map<string, ScheduleColumn>();
  const jobColumns = new Map<string, string>();
  const virtualJobs: JobsMapPoint[] = [];

  for (const truck of trucks) {
    const column = physicalTruckColumn(truck);
    if (column) physicalColumns.set(column.key, column);
  }

  for (const job of [...jobs].sort(scheduleSort)) {
    const column = physicalTruckColumn(job.truck);
    if (column) {
      physicalColumns.set(column.key, column);
      jobColumns.set(job.key, column.key);
    } else {
      virtualJobs.push(job);
    }
  }

  const virtualLaneEnds: number[] = [];
  for (const job of virtualJobs) {
    const start = job.appointmentStartMinutes ?? Number.MAX_SAFE_INTEGER - 120;
    const end = job.appointmentEndMinutes ?? (start + 60);
    let lane = virtualLaneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane < 0) {
      lane = virtualLaneEnds.length;
      virtualLaneEnds.push(end);
    } else {
      virtualLaneEnds[lane] = end;
    }
    jobColumns.set(job.key, `virtual-${lane + 1}`);
  }

  const columns = [
    ...Array.from(physicalColumns.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    ...Array.from({ length: Math.max(virtualLaneEnds.length, 1) }, (_, index) => ({
      key: `virtual-${index + 1}`,
      label: "VT",
      virtual: true,
      assignment: "",
    })),
  ];

  const timed = jobs.filter((job) => job.appointmentStartMinutes != null);
  const earliest = timed.length ? Math.min(...timed.map((job) => job.appointmentStartMinutes as number)) : 8 * 60;
  const latest = timed.length
    ? Math.max(...timed.map((job) => job.appointmentEndMinutes ?? ((job.appointmentStartMinutes as number) + 60)))
    : 17 * 60;
  const firstHour = Math.min(8, Math.floor(earliest / 60));
  const lastHour = Math.max(17, Math.ceil(latest / 60));
  const rows = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index);
  const untimed = jobs.some((job) => job.appointmentStartMinutes == null);

  return { columns, jobColumns, rows, untimed };
}

function compactHourLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  return `${normalized % 12 || 12} ${normalized >= 12 ? "PM" : "AM"}`;
}

function timelineHourLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  return `${normalized % 12 || 12}${normalized >= 12 ? "p" : "a"}`;
}

function scheduleDropTargetKey(column: ScheduleColumn, startMinutes?: number): string {
  return `${column.key}|${startMinutes === undefined ? "keep" : startMinutes}`;
}

function scheduleDropTarget(value: string, columns: ScheduleColumn[]): { column: ScheduleColumn; startMinutes?: number } | null {
  const [columnKey, rawStart] = String(value || "").split("|");
  const column = columns.find((candidate) => candidate.key === columnKey);
  if (!column) return null;
  if (rawStart === "keep") return { column };
  const startMinutes = Number(rawStart);
  return Number.isInteger(startMinutes) ? { column, startMinutes } : null;
}

function movedAppointmentTime(job: JobsMapPoint, startMinutes: number): ScheduleTimeOverride {
  const durationMinutes = job.appointmentStartMinutes != null && job.appointmentEndMinutes != null
    ? Math.max(60, job.appointmentEndMinutes - job.appointmentStartMinutes)
    : 60;
  const appointmentEndMinutes = startMinutes + durationMinutes;
  const clock = (minutes: number) => {
    const hour = Math.floor(minutes / 60);
    return `${String(hour % 12 || 12).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
  };
  return {
    appointmentTime: `${clock(startMinutes)} - ${clock(appointmentEndMinutes)}`,
    appointmentStartMinutes: startMinutes,
    appointmentEndMinutes,
  };
}

function routeTruck(value: string): string {
  const match = String(value || "").match(/truck\s*#?\s*(\d+)/i);
  return match ? `Truck ${match[1]}` : "";
}

function sameTruck(left: string, right: string): boolean {
  const normalizedLeft = routeTruck(left);
  const normalizedRight = routeTruck(right);
  if (normalizedLeft && normalizedRight) return normalizedLeft === normalizedRight;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function JobsMap({ date, jobs, scheduleView, trucks, truckLocations }: JobsMapProps) {
  const router = useRouter();
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapSelectionRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any>(null);
  const routesRef = useRef<any>(null);
  const defaultMapDateRef = useRef("");
  const [leaflet, setLeaflet] = useState<LeafletModule | null>(null);
  const [mapZoom, setMapZoom] = useState(DEFAULT_DISPATCH_MAP_ZOOM);
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedTruckName, setSelectedTruckName] = useState("");
  const [focusSelectedTruck, setFocusSelectedTruck] = useState(false);
  const [selectedTruckAddress, setSelectedTruckAddress] = useState({ key: "", address: "", loading: false, error: "" });
  const [proximity, setProximity] = useState<JobRouteProximityPayload | null>(null);
  const [proximityLoading, setProximityLoading] = useState(scheduleView);
  const [proximityError, setProximityError] = useState("");
  const [liveTruckLocations, setLiveTruckLocations] = useState(truckLocations);
  const [linxupUpdatedAt, setLinxupUpdatedAt] = useState<string | null>(
    truckLocations.map((truck) => truck.lastGpsUpdate).filter(Boolean).sort().at(-1) || null,
  );
  const linxupUpdatedAtRef = useRef(linxupUpdatedAt);
  const [linxupUpdateDelayed, setLinxupUpdateDelayed] = useState(false);
  const [showAddressVerification, setShowAddressVerification] = useState(false);
  const serverAssignments = useMemo(
    () => Object.fromEntries(jobs.map((job) => [job.key, routeTruck(job.truck)])),
    [jobs],
  );
  const [assignments, setAssignments] = useState<Record<string, string>>(serverAssignments);
  const [timeOverrides, setTimeOverrides] = useState<Record<string, ScheduleTimeOverride>>({});
  const [draggedKey, setDraggedKey] = useState("");
  const [dropTarget, setDropTarget] = useState("");
  const dragGestureRef = useRef<ScheduleDragGesture | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const suppressNextClickRef = useRef(false);
  const [dragGesture, setDragGesture] = useState<ScheduleDragGesture | null>(null);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const pendingKeySetRef = useRef<Set<string>>(new Set());
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const [cancelTarget, setCancelTarget] = useState<AppointmentCancelTarget | null>(null);
  const [canceledKeys, setCanceledKeys] = useState<string[]>([]);
  const [currentScheduleTime, setCurrentScheduleTime] = useState<ReturnType<typeof chicagoScheduleClock> | null>(null);

  const selectLiveTruck = useCallback((truckName: string) => {
    setSelectedKey("");
    setFocusSelectedTruck(true);
    setSelectedTruckName(truckName);
    window.dispatchEvent(new CustomEvent(APPOINTMENT_SELECTION_EVENT, { detail: { articleId: "" } }));
  }, []);

  const selectMapTruck = useCallback((truckName: string) => {
    setSelectedKey("");
    setFocusSelectedTruck(false);
    setSelectedTruckName(truckName);
    window.dispatchEvent(new CustomEvent(APPOINTMENT_SELECTION_EVENT, { detail: { articleId: "" } }));
  }, []);

  const focusTerritory = useCallback((territory: typeof DISPATCH_TERRITORY_SHORTCUTS[number]) => {
    setSelectedKey("");
    setFocusSelectedTruck(false);
    setSelectedTruckName("");
    window.dispatchEvent(new CustomEvent(APPOINTMENT_SELECTION_EVENT, { detail: { articleId: "" } }));
    mapRef.current?.setView(territory.center, DISPATCH_TERRITORY_ZOOM, { animate: true });
  }, []);

  useEffect(() => {
    setAssignments(serverAssignments);
    setTimeOverrides({});
  }, [serverAssignments]);

  useEffect(() => {
    setLiveTruckLocations(truckLocations);
    const latest = truckLocations.map((truck) => truck.lastGpsUpdate).filter(Boolean).sort().at(-1) || null;
    if (latest) {
      linxupUpdatedAtRef.current = latest;
      setLinxupUpdatedAt(latest);
    }
  }, [truckLocations]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  useEffect(() => {
    if (!scheduleView) {
      setCurrentScheduleTime(null);
      return;
    }
    const updateClock = () => setCurrentScheduleTime(chicagoScheduleClock());
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, [scheduleView]);

  const displayJobs = useMemo<JobsMapPoint[]>(
    () => jobs.map((job) => {
      const timeOverride = timeOverrides[job.key];
      const assignedTruck = assignments[job.key] || "Virtual Truck";
      const canceled = canceledKeys.includes(job.key);
      const liveJob = {
        ...job,
        ...(timeOverride || {}),
        truck: assignedTruck,
        ...(canceled ? { status: "Canceled", statusBucket: "Canceled" } : {}),
      };
      const scheduleClock = chicagoScheduleClock();
      const isCurrentDate = scheduleClock.date === date;
      const now = currentScheduleTime?.timestamp ?? Date.now();
      const liveVisitedTrucks = isCurrentDate ? trucksThatVisitedJob(liveJob, liveTruckLocations, now) : [];
      return {
        ...liveJob,
        truckOnSite: isCurrentDate && anyTruckIsCurrentlyAtJob(liveJob, liveTruckLocations, now),
        visitedTrucks: Array.from(new Set([...liveJob.visitedTrucks, ...liveVisitedTrucks])),
      };
    }),
    [assignments, canceledKeys, currentScheduleTime?.timestamp, date, jobs, liveTruckLocations, timeOverrides],
  );

  const locatedJobs = useMemo(() => displayJobs.filter(isLocated), [displayJobs]);
  const unlocatedJobs = useMemo(() => displayJobs.filter((job) => !isLocated(job)), [displayJobs]);
  const mapCoverage = useMemo(() => dispatchMapCoverage(displayJobs), [displayJobs]);
  const scheduledJobs = useMemo(() => [...displayJobs].sort(scheduleSort), [displayJobs]);
  const scheduleBoard = useMemo(() => buildScheduleBoard(displayJobs, trucks), [displayJobs, trucks]);
  const selectedJob = useMemo(
    () => displayJobs.find((job) => job.key === selectedKey) || null,
    [displayJobs, selectedKey],
  );
  const selectedTruck = useMemo(
    () => liveTruckLocations.find((truck) => truck.truck === selectedTruckName) || null,
    [liveTruckLocations, selectedTruckName],
  );
  const selectedTruckRoutes = useMemo(
    () => selectedTruck ? buildJobRouteHistory(selectedTruck.routePoints, selectedTruck.jobStops) : [],
    [selectedTruck],
  );
  const selectedTruckCameraNumber = selectedTruck
    ? parseTruckNumberFromLabel(selectedTruck.truck)
    : null;
  const selectedJobKey = selectedJob?.key || "";
  const resetMapToOperatingFootprint = useCallback((animate: boolean) => {
    mapRef.current?.fitBounds(DEFAULT_DISPATCH_MAP_BOUNDS, {
      padding: DEFAULT_DISPATCH_MAP_PADDING,
      maxZoom: DEFAULT_DISPATCH_MAP_ZOOM,
      animate,
    });
  }, []);
  const closestTruck = selectedJob ? nearestTruck(selectedJob.key, proximity) : null;
  const currentTimeLine = useMemo(() => {
    if (!currentScheduleTime || currentScheduleTime.date !== date || !scheduleBoard.rows.length) return null;
    const firstHour = scheduleBoard.rows[0];
    const finalHour = scheduleBoard.rows[scheduleBoard.rows.length - 1] + 1;
    if (currentScheduleTime.minutes < firstHour * 60 || currentScheduleTime.minutes > finalHour * 60) return null;
    const elapsedHours = (currentScheduleTime.minutes - firstHour * 60) / 60;
    const timeColumnCount = scheduleBoard.rows.length + (scheduleBoard.untimed ? 1 : 0);
    return {
      label: currentScheduleTime.label,
      left: `min(calc(${SCHEDULE_TRUCK_COLUMN_WIDTH}px + (100% - ${SCHEDULE_TRUCK_COLUMN_WIDTH}px) * ${elapsedHours / Math.max(timeColumnCount, 1)}), calc(100% - 6px))`,
    };
  }, [currentScheduleTime, date, scheduleBoard.rows, scheduleBoard.untimed]);

  useEffect(() => {
    if (!selectedJobKey && !selectedTruckName) return;
    const frame = window.requestAnimationFrame(() => {
      mapSelectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedJobKey, selectedTruckName]);
  const scheduleTruckRows: ScheduleColumn[] = scheduleBoard.columns.length
    ? scheduleBoard.columns
    : [{ key: "empty", label: "—", virtual: false, assignment: "" }];
  const scheduleTimeColumnCount = scheduleBoard.rows.length + (scheduleBoard.untimed ? 1 : 0);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(APPOINTMENT_ON_SITE_EVENT, {
      detail: {
        statuses: Object.fromEntries(displayJobs.map((job) => [job.detailId, job.truckOnSite])),
      },
    }));
  }, [displayJobs]);

  useEffect(() => {
    if (selectedKey && !jobs.some((job) => job.key === selectedKey)) {
      setSelectedKey("");
      window.dispatchEvent(new CustomEvent(APPOINTMENT_SELECTION_EVENT, { detail: { articleId: "" } }));
    }
  }, [jobs, selectedKey]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelectedKey("");
      setSelectedTruckName("");
      setFocusSelectedTruck(false);
      mapRef.current?.closePopup();
      resetMapToOperatingFootprint(true);
      window.dispatchEvent(new CustomEvent(APPOINTMENT_SELECTION_EVENT, { detail: { articleId: "" } }));
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [resetMapToOperatingFootprint]);

  useEffect(() => {
    if (selectedTruckName && !liveTruckLocations.some((truck) => truck.truck === selectedTruckName)) setSelectedTruckName("");
  }, [liveTruckLocations, selectedTruckName]);

  useEffect(() => {
    if (chicagoScheduleClock().date !== date) return;

    let active = true;
    let requestInFlight = false;
    const controller = new AbortController();

    async function loadLiveLinxup() {
      if (!active || requestInFlight || document.visibilityState === "hidden") return;
      requestInFlight = true;
      try {
        const response = await fetch(`/api/fleet-live-status?date=${encodeURIComponent(date)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as FleetLiveStatusPayload | null;
        if (!response.ok || !Array.isArray(payload?.trucks)) throw new Error("Live Linxup GPS is unavailable.");
        if (!active) return;
        const updatedAt = payload.lastUpdatedAt || null;
        if (updatedAt !== linxupUpdatedAtRef.current) {
          linxupUpdatedAtRef.current = updatedAt;
          setLiveTruckLocations(payload.trucks);
          setLinxupUpdatedAt(updatedAt);
        }
        setLinxupUpdateDelayed(false);
      } catch {
        if (active && !controller.signal.aborted) setLinxupUpdateDelayed(true);
      } finally {
        requestInFlight = false;
      }
    }

    void loadLiveLinxup();
    const timer = window.setInterval(() => void loadLiveLinxup(), LINXUP_POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadLiveLinxup();
    };
    const handleOnline = () => void loadLiveLinxup();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
    };
  }, [date]);

  useEffect(() => {
    if (!selectedTruck) {
      setSelectedTruckAddress({ key: "", address: "", loading: false, error: "" });
      return;
    }

    const key = `${selectedTruck.truck}:${selectedTruck.latitude.toFixed(5)},${selectedTruck.longitude.toFixed(5)}`;
    let active = true;
    const controller = new AbortController();
    setSelectedTruckAddress({ key, address: "", loading: true, error: "" });

    fetch("/api/fleet-location-address", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latitude: selectedTruck.latitude, longitude: selectedTruck.longitude }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Current address is unavailable.");
        return String(payload?.address || "").trim();
      })
      .then((address) => {
        if (!active) return;
        setSelectedTruckAddress({
          key,
          address,
          loading: false,
          error: address ? "" : "Street address unavailable for this GPS point.",
        });
      })
      .catch((error) => {
        if (!active || controller.signal.aborted) return;
        setSelectedTruckAddress({
          key,
          address: "",
          loading: false,
          error: error instanceof Error ? error.message : "Current address is unavailable.",
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedTruck]);

  async function assignJob(job: JobsMapPoint, truck: string, appointmentStartMinutes?: number) {
    const previousTruck = assignments[job.key] || "";
    const previousTimeOverride = timeOverrides[job.key];
    const timeOverride = appointmentStartMinutes === undefined
      ? undefined
      : movedAppointmentTime(job, appointmentStartMinutes);
    const timeChanged = timeOverride !== undefined && job.appointmentStartMinutes !== appointmentStartMinutes;
    if (pendingKeySetRef.current.has(job.key)) return;
    if (previousTruck === truck && !timeChanged) {
      setAssignmentMessage(`${job.jkNumber} is already on ${truck || "Virtual / unassigned"}${appointmentStartMinutes === undefined ? "" : ` at ${compactHourLabel(appointmentStartMinutes / 60)}`}.`);
      return;
    }
    if (!job.appointmentId || job.assignmentKey !== `appt:${job.appointmentId}`) {
      setAssignmentMessage("This appointment cannot be changed because its JunkWare appointment ID is unavailable.");
      return;
    }

    pendingKeySetRef.current.add(job.key);
    setAssignments((current) => ({ ...current, [job.key]: truck }));
    if (timeOverride) setTimeOverrides((current) => ({ ...current, [job.key]: timeOverride }));
    setPendingKeys((current) => [...current, job.key]);
    setAssignmentMessage(`Moving ${job.jkNumber} to ${truck || "Virtual / unassigned"}${timeOverride ? ` at ${compactHourLabel(timeOverride.appointmentStartMinutes / 60)}` : ""} in JunkWare…`);

    try {
      const response = await fetch("/api/job-route-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          jobKey: job.assignmentKey,
          truck,
          appointmentId: job.appointmentId,
          ...(timeOverride ? {
            appointmentStartMinutes: timeOverride.appointmentStartMinutes,
            durationHours: Math.max(1, Math.round((timeOverride.appointmentEndMinutes - timeOverride.appointmentStartMinutes) / 60)),
          } : {}),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "The schedule change could not be saved.");
      setAssignmentMessage(payload.junkwareSynced === false
        ? (payload.warning || `${job.jkNumber} is saved in OpsCenter; JunkWare verification is pending.`)
        : truck
          ? `${job.jkNumber} was verified in JunkWare and moved to ${truck}${timeOverride ? ` at ${compactHourLabel(timeOverride.appointmentStartMinutes / 60)}` : ""}.`
          : `${job.jkNumber} was verified in JunkWare and moved to Virtual / unassigned${timeOverride ? ` at ${compactHourLabel(timeOverride.appointmentStartMinutes / 60)}` : ""}.`);
      router.refresh();
    } catch (error) {
      setAssignments((current) => ({ ...current, [job.key]: previousTruck }));
      setTimeOverrides((current) => {
        const next = { ...current };
        if (previousTimeOverride) next[job.key] = previousTimeOverride;
        else delete next[job.key];
        return next;
      });
      setAssignmentMessage(error instanceof Error ? error.message : "The schedule change could not be saved.");
    } finally {
      pendingKeySetRef.current.delete(job.key);
      setPendingKeys((current) => current.filter((key) => key !== job.key));
    }
  }

  function clearDragGesture() {
    dragGestureRef.current = null;
    setDragGesture(null);
    setDraggedKey("");
    setDropTarget("");
  }

  function handleAppointmentPointerDown(event: React.PointerEvent<HTMLButtonElement>, job: JobsMapPoint) {
    if (event.button !== 0 || job.statusBucket === "Canceled" || pendingKeySetRef.current.has(job.key)) return;
    dragCleanupRef.current?.();
    const gesture: ScheduleDragGesture = {
      key: job.key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    dragGestureRef.current = gesture;
    setDragGesture(gesture);
    setDraggedKey(job.key);
    setSelectedTruckName("");
    setSelectedKey(job.key);

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };
    const handlePointerMove = (pointerEvent: PointerEvent) => {
      const current = dragGestureRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      const active = current.active || Math.hypot(pointerEvent.clientX - current.startX, pointerEvent.clientY - current.startY) >= 6;
      const next = { ...current, x: pointerEvent.clientX, y: pointerEvent.clientY, active };
      dragGestureRef.current = next;
      setDragGesture(next);
      if (!active) return;

      pointerEvent.preventDefault();
      const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest<HTMLElement>("[data-schedule-drop-key]");
      setDropTarget(target?.dataset.scheduleDropKey || "");
    };
    const handlePointerUp = (pointerEvent: PointerEvent) => {
      const current = dragGestureRef.current;
      if (!current || current.pointerId !== pointerEvent.pointerId) return;
      cleanup();
      if (current.active) {
        pointerEvent.preventDefault();
        suppressNextClickRef.current = true;
        const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest<HTMLElement>("[data-schedule-drop-key]");
        const targetKey = target?.dataset.scheduleDropKey || "";
        const destination = scheduleDropTarget(targetKey, scheduleBoard.columns);
        if (destination) void assignJob(job, destination.column.assignment, destination.startMinutes);
      }
      clearDragGesture();
    };
    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      if (dragGestureRef.current?.pointerId !== pointerEvent.pointerId) return;
      cleanup();
      clearDragGesture();
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
  }

  function handleAppointmentClick(jobKey: string) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    setSelectedTruckName("");
    setSelectedKey(jobKey);

    const job = displayJobs.find((candidate) => candidate.key === jobKey);
    if (!job?.detailId) return;
    window.dispatchEvent(new CustomEvent(APPOINTMENT_SELECTION_EVENT, {
      detail: { articleId: job.detailId },
    }));
  }

  function showAppointmentInQueue(job: JobsMapPoint) {
    if (!job.detailId) return;
    window.dispatchEvent(new CustomEvent(APPOINTMENT_SELECTION_EVENT, {
      detail: { articleId: job.detailId },
    }));
    document.getElementById("jobs-schedule")?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => {
      document.getElementById(job.detailId)?.focus({ preventScroll: true });
    });
  }

  function handleAppointmentContextMenu(event: React.MouseEvent<HTMLButtonElement>, job: JobsMapPoint) {
    event.preventDefault();
    clearDragGesture();
    if (job.statusBucket === "Canceled") {
      setAssignmentMessage(`${job.jkNumber} is already canceled.`);
      return;
    }
    if (isClosedScheduleJob(job)) {
      setAssignmentMessage(`${job.jkNumber} is already closed and cannot be canceled from the Schedule board.`);
      return;
    }
    if (!/^\d{1,12}$/.test(job.appointmentId) || job.assignmentKey !== `appt:${job.appointmentId}`) {
      setAssignmentMessage("This appointment cannot be canceled because its JunkWare appointment ID is unavailable.");
      return;
    }
    setSelectedTruckName("");
    setSelectedKey(job.key);
    setCancelTarget({
      date,
      appointmentId: job.appointmentId,
      jobKey: job.assignmentKey,
      jkNumber: job.jkNumber,
      customerName: job.customerName,
      appointmentTime: job.appointmentTime,
    });
  }

  function handleAppointmentDragStart(event: React.DragEvent<HTMLButtonElement>, job: JobsMapPoint) {
    if (job.statusBucket === "Canceled" || pendingKeySetRef.current.has(job.key)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", job.key);
    event.dataTransfer.effectAllowed = "move";
    setDraggedKey(job.key);
    setSelectedTruckName("");
    setSelectedKey(job.key);
  }

  function handleScheduleDrop(event: React.DragEvent<HTMLElement>, column: ScheduleColumn, appointmentStartMinutes?: number) {
    event.preventDefault();
    const jobKey = event.dataTransfer.getData("text/plain") || draggedKey;
    const job = displayJobs.find((candidate) => candidate.key === jobKey);
    clearDragGesture();
    if (job) void assignJob(job, column.assignment, appointmentStartMinutes);
  }

  function scheduleDropHandlers(column: ScheduleColumn, appointmentStartMinutes?: number) {
    const targetKey = scheduleDropTargetKey(column, appointmentStartMinutes);
    return {
      onDragEnter: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        setDropTarget(targetKey);
      },
      onDragOver: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (dropTarget !== targetKey) setDropTarget(targetKey);
      },
      onDragLeave: (event: React.DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget("");
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => handleScheduleDrop(event, column, appointmentStartMinutes),
    };
  }

  useEffect(() => {
    let active = true;
    import("leaflet").then((module) => {
      if (!active) return;
      const resolved = ((module as unknown as { default?: LeafletModule }).default || module) as LeafletModule;
      setLeaflet(resolved);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!scheduleView) {
      setProximity(null);
      setProximityLoading(false);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const proximityJobs = jobs
      .filter((job) => job.address && job.address !== "—" && job.address !== "Address unavailable")
      .slice(0, 100)
      .map((job) => ({
        jobKey: job.key,
        address: job.address,
        latitude: job.latitude,
        longitude: job.longitude,
      }));

    async function loadProximity(initial: boolean) {
      if (!proximityJobs.length) {
        setProximityLoading(false);
        return;
      }
      if (initial) setProximityLoading(true);
      try {
        const response = await fetch("/api/job-route-proximity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, jobs: proximityJobs, fleetUpdatedAt: linxupUpdatedAt }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.distances) throw new Error(payload?.error || "Truck locations are unavailable.");
        if (!active) return;
        setProximity(payload);
        setProximityError("");
      } catch (error) {
        if (!active) return;
        setProximityError(error instanceof Error ? error.message : "Truck locations are unavailable.");
      } finally {
        if (active && initial) setProximityLoading(false);
      }
    }

    void loadProximity(true);
    timer = setInterval(() => void loadProximity(false), 5 * 60_000);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [date, jobs, scheduleView, linxupUpdatedAt]);

  const selectedRouteBounds = useMemo(() => {
    if (!leaflet || !selectedTruck) return null;
    const points = selectedTruck.routePoints
      .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
      .map((point) => [point.latitude, point.longitude] as [number, number]);
    return points.length ? leaflet.latLngBounds(points) : null;
  }, [leaflet, selectedTruck]);

  useEffect(() => {
    if (!leaflet || !mapNodeRef.current || mapRef.current) return;

    const map = leaflet.map(mapNodeRef.current, {
      center: DEFAULT_DISPATCH_MAP_CENTER,
      zoom: DEFAULT_DISPATCH_MAP_ZOOM,
      zoomControl: true,
      scrollWheelZoom: "center",
      touchZoom: true,
      doubleClickZoom: true,
      keyboard: true,
      attributionControl: true,
    });
    leaflet.tileLayer(STREET_TILES, {
      attribution: STREET_ATTRIBUTION,
      maxZoom: 20,
    }).addTo(map);
    // Keep live truck icons above appointment pins and count circles regardless
    // of the marker's latitude-derived Leaflet z-index.
    const truckMarkerPane = map.getPane(TRUCK_MARKER_PANE) || map.createPane(TRUCK_MARKER_PANE);
    truckMarkerPane.style.zIndex = "675";
    mapRef.current = map;
    resetMapToOperatingFootprint(false);
    map.scrollWheelZoom.enable();
    map.touchZoom.enable();
    map.doubleClickZoom.enable();
    map.keyboard.enable();
    markersRef.current = leaflet.layerGroup().addTo(map);
    routesRef.current = leaflet.layerGroup().addTo(map);
    const updateMarkerClusters = () => setMapZoom(map.getZoom());
    map.on("zoomend", updateMarkerClusters);

    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => map.invalidateSize({ pan: false, debounceMoveend: true }));
    resizeObserver?.observe(mapNodeRef.current);
    window.requestAnimationFrame(() => map.invalidateSize());

    return () => {
      resizeObserver?.disconnect();
      map.off("zoomend", updateMarkerClusters);
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
      routesRef.current = null;
    };
  }, [leaflet, resetMapToOperatingFootprint]);

  useEffect(() => {
    if (!mapRef.current || defaultMapDateRef.current === date) return;
    defaultMapDateRef.current = date;
    const frame = window.requestAnimationFrame(() => resetMapToOperatingFootprint(false));
    return () => window.cancelAnimationFrame(frame);
  }, [date, resetMapToOperatingFootprint]);

  // Schedule-board truck selection earns one initial focus. Do not keep that
  // focus armed: mapZoom changes whenever Dispatch redraws marker clusters, and
  // a persistent focus would undo a dispatcher’s manual pan or zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusSelectedTruck || !selectedTruck) return;

    if (selectedRouteBounds?.isValid()) {
      if (selectedRouteBounds.getNorthEast().equals(selectedRouteBounds.getSouthWest())) {
        map.setView(selectedRouteBounds.getCenter(), 14, { animate: true });
      } else {
        map.fitBounds(selectedRouteBounds.pad(0.1), { padding: [28, 28], maxZoom: 15, animate: true });
      }
    } else {
      map.setView([selectedTruck.latitude, selectedTruck.longitude], Math.max(map.getZoom(), 14), { animate: true });
    }

    setFocusSelectedTruck(false);
  }, [focusSelectedTruck, selectedRouteBounds, selectedTruck]);

  useEffect(() => {
    const map = mapRef.current;
    const markers = markersRef.current;
    const routes = routesRef.current;
    if (!leaflet || !map || !markers || !routes) return;

    markers.clearLayers();
    routes.clearLayers();

    selectedTruckRoutes.forEach((segment, index) => {
      segment.paths.forEach((path) => {
        const linePoints = path.map((point) => [point.latitude, point.longitude] as [number, number]);
        leaflet.polyline(linePoints, {
          color: segment.color,
          weight: segment.kind === "current" ? 4 : 5,
          opacity: segment.kind === "current" ? 0.78 : 0.96,
          dashArray: segment.kind === "current" ? "8 8" : undefined,
          lineJoin: "round",
          lineCap: "round",
        })
          .bindTooltip(
            `${segment.kind === "job" ? `Route ${index + 1} · ` : ""}${segment.label} · ${routeTime(path[0].timestamp)}–${routeTime(path.at(-1)?.timestamp || "")}`,
            { sticky: true },
          )
          .addTo(routes);
      });

      if (!segment.stop) return;
      leaflet.circleMarker([segment.stop.latitude, segment.stop.longitude], {
        radius: 7,
        color: segment.color,
        weight: 3,
        fillColor: "#081018",
        fillOpacity: 1,
      })
        .bindTooltip(`Job ${index + 1} · ${segment.stop.label} · arrived ${routeTime(segment.stop.begin)}`, {
          direction: "top",
          offset: [0, -5],
        })
        .addTo(routes);
    });

    // Appointment counts and truck locators are independent. Area circles are
    // appointments only; every live truck keeps its own visible GPS locator.
    const jobsByClusterArea = new Map<string, Array<JobsMapPoint & { latitude: number; longitude: number }>>();
    for (const job of locatedJobs) {
      const area = appointmentClusterArea(job);
      jobsByClusterArea.set(area, [...(jobsByClusterArea.get(area) || []), job]);
    }
    const jobClusters = Array.from(jobsByClusterArea.values())
      .flatMap((areaJobs) => clusterVisibleMapItems(map, areaJobs, (job) => job, 44));
    const truckMarkers = spreadLiveTruckMarkers(map, liveTruckLocations);

    const selectMapJob = (key: string) => {
      setFocusSelectedTruck(false);
      setSelectedTruckName("");
      setSelectedKey(key);
    };
    const focusMapArea = (items: Array<{ latitude: number | null; longitude: number | null }>) => {
      const points = items
        .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
        .map((item) => [item.latitude, item.longitude] as [number, number]);
      if (!points.length) return;
      const bounds = leaflet.latLngBounds(points);
      if (points.length > 1 && !bounds.getNorthEast().equals(bounds.getSouthWest())) {
        map.fitBounds(bounds.pad(0.32), { padding: [28, 28], maxZoom: 15, animate: true });
        return;
      }
      map.setView(points[0], Math.max(map.getZoom(), 14), { animate: true });
    };
    // Leaflet renders div-icon markers as DOM buttons, but its delegated map
    // click bridge can lose the marker target after a React layer refresh.
    // Bind activation to the rendered marker itself so mouse and keyboard
    // selection remain dependable without moving the marker off its location.
    const addInteractiveMarker = (marker: any, activate: () => void) => {
      marker.addTo(markers);
      const element = marker.getElement();
      if (!element) return;
      const handleActivation = (event: MouseEvent | KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        activate();
      };
      element.addEventListener("click", handleActivation);
      element.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") handleActivation(event);
      });
    };
    for (const cluster of jobClusters) {
      if (cluster.items.length > 1) {
        const marker = leaflet.marker([cluster.latitude, cluster.longitude], {
          icon: appointmentClusterIcon(leaflet, cluster.items.length, clusterTerritoryTone(cluster.items)),
          keyboard: true,
          title: `${cluster.items.length} appointments in this area`,
          alt: `${cluster.items.length} appointments in this area`,
          zIndexOffset: 1000,
        });
        addInteractiveMarker(marker, () => focusMapArea(cluster.items));
        continue;
      }

      const job = cluster.items[0];
      const markerLabel = `${job.appointmentTime} · ${job.customerName} · ${job.jkNumber}`;
      const marker = leaflet.marker([job.latitude, job.longitude], {
        icon: markerIcon(leaflet, job, selectedKey === job.key),
        keyboard: true,
        title: markerLabel,
        alt: markerLabel,
        zIndexOffset: selectedKey === job.key ? 1100 : 1000,
      });
      const itemSummary = job.junkItems.length ? ` · ${job.junkItems.join(", ")}` : " · Items not listed";
      marker.bindTooltip(`${job.appointmentTime} · ${job.customerName}${itemSummary}`, {
        direction: "top",
        offset: [0, -10],
      });
      addInteractiveMarker(marker, () => selectMapJob(job.key));
    }

    for (const { truck, latitude, longitude } of truckMarkers) {
      const markerLabel = `${truck.truck} · ${truck.status} · ${truck.freshness}`;
      const atJob = truckIsCurrentlyAtAnyJob(truck, locatedJobs, currentScheduleTime?.timestamp ?? Date.now());
      const marker = leaflet.marker([latitude, longitude], {
        icon: truckIcon(leaflet, truck, truck.truck === selectedTruckName, atJob),
        pane: TRUCK_MARKER_PANE,
        keyboard: true,
        title: markerLabel,
        alt: markerLabel,
        zIndexOffset: truck.truck === selectedTruckName ? 1500 : 1400,
      });
      const driver = truck.driver && truck.driver !== "—" ? ` · ${truck.driver}` : "";
      marker.bindTooltip(`${truck.truck} · ${truck.status}${driver} · ${truck.freshness}`, {
        direction: "top",
        offset: [0, -22],
      });
      addInteractiveMarker(marker, () => selectMapTruck(truck.truck));
    }

  }, [currentScheduleTime?.timestamp, leaflet, liveTruckLocations, locatedJobs, mapZoom, selectLiveTruck, selectMapTruck, selectedKey, selectedTruckName, selectedTruckRoutes]);

  const renderAppointmentDetails = () => {
    if (selectedTruck || !selectedJob) return null;
    return (
      <article ref={mapSelectionRef} className="ops-jobs-map-selection" aria-live="polite">
        <button
          type="button"
          className="ops-jobs-map-selection-close"
          onClick={() => {
            setSelectedKey("");
            window.dispatchEvent(new CustomEvent(APPOINTMENT_SELECTION_EVENT, { detail: { articleId: "" } }));
          }}
          aria-label="Close appointment details"
        >×</button>
        <div className="ops-jobs-map-selection-kicker">
          <i className={territoryTone(selectedJob)} aria-hidden="true" />
          {selectedJob.appointmentTime} · {selectedJob.jkNumber}
        </div>
        <strong className="ops-jobs-map-selection-customer">{selectedJob.customerName}</strong>
        {selectedJob.phone && selectedJob.phone !== "—" ? (
          <a
            className="ops-jobs-map-selection-phone"
            href={`tel:${selectedJob.phone.replace(/[^\d+]/g, "")}`}
          >
            {selectedJob.phone}
          </a>
        ) : (
          <span className="ops-jobs-map-selection-phone is-unavailable">Phone unavailable</span>
        )}
        <span className="ops-jobs-map-selection-address">{selectedJob.address}</span>
        {selectedJob.statusBucket === "Canceled" ? (
          <div className="ops-jobs-map-selection-canceled" role="status">
            <b aria-hidden="true">×</b>
            <span><strong>Canceled</strong>{selectedJob.status}</span>
          </div>
        ) : null}
        {hasJunkwareSyncFailure(selectedJob) ? (
          <div className="ops-jobs-map-selection-sync-failed" role="status">
            <b aria-hidden="true">!</b>
            <span>
              <strong>{junkwareSyncLabel(selectedJob)}</strong>
              {selectedJob.junkwareSyncError || (selectedJob.junkwareSyncStatus === "manual_correction"
                ? "Saved in OpsCenter. Correct the JunkWare validation error, then submit the assignment again."
                : "Saved in OpsCenter. It will be retried before it is treated as verified.")}
            </span>
          </div>
        ) : null}
        {isVisitedUnclosedScheduleJob(selectedJob) ? (
          <div className="ops-jobs-map-selection-visited-unclosed" role="status">
            <b aria-hidden="true">?</b>
            <span>
              <strong>Krewe visited this address</strong>
              Appointment is not closed out in JunkWare
              {selectedJob.visitedTrucks.length ? <small>{selectedJob.visitedTrucks.join(", ")}</small> : null}
            </span>
          </div>
        ) : null}
        <div className="ops-jobs-map-selection-items">
          <span>Items to remove</span>
          {selectedJob.junkItems.length ? (
            <div>{selectedJob.junkItems.map((item) => <strong key={item}>{item}</strong>)}</div>
          ) : <em>Not listed in JunkWare</em>}
        </div>
        {selectedJob.appointmentNotes.length ? (
          <details className="ops-jobs-map-selection-notes">
            <summary>Franchise / call-center notes <small>{selectedJob.appointmentNotes.length}</small></summary>
            <ul>{selectedJob.appointmentNotes.map((note, index) => <li key={`${selectedJob.key}-note-${index}`}>{note}</li>)}</ul>
          </details>
        ) : null}
        {selectedJob.statusBucket !== "Canceled" ? <div className="ops-jobs-map-selection-truck">
          <span>Closest truck</span>
          <strong>
            {!scheduleView
              ? "Open the daily schedule for live proximity"
              : proximityLoading
                ? "Checking current truck locations…"
                : proximityError
                  ? "Truck locations unavailable"
                  : closestTruck
                    ? `${closestTruck.truck} · ${proximityText(closestTruck.proximity)}`
                    : unavailableProximityText(selectedJob.key, proximity)}
          </strong>
        </div> : null}
        {scheduleView && selectedJob.statusBucket !== "Canceled" ? (
          <div className="ops-jobs-map-selection-schedule-controls">
            <label className="ops-jobs-map-selection-assign">
              <span>Truck assignment</span>
              <select
                value={assignments[selectedJob.key] || ""}
                disabled={pendingKeys.includes(selectedJob.key)}
                onChange={(event) => void assignJob(selectedJob, event.target.value)}
              >
                <option value="">Virtual / unassigned</option>
                {trucks.map((truck) => <option value={truck} key={truck}>{truck}</option>)}
              </select>
            </label>
            <label className="ops-jobs-map-selection-assign">
              <span>Time slot</span>
              <select
                value={selectedJob.appointmentStartMinutes ?? ""}
                disabled={pendingKeys.includes(selectedJob.key)}
                onChange={(event) => void assignJob(selectedJob, assignments[selectedJob.key] || "", Number(event.target.value))}
              >
                {selectedJob.appointmentStartMinutes == null ? <option value="">Choose a time…</option> : null}
                {scheduleBoard.rows.map((hour) => <option value={hour * 60} key={hour}>{compactHourLabel(hour)}</option>)}
              </select>
            </label>
          </div>
        ) : null}
        <div className="ops-jobs-map-selection-actions">
          <button type="button" onClick={() => showAppointmentInQueue(selectedJob)}>
            <span>Show in Appointments</span>
            <small>Open closeout controls</small>
          </button>
          {selectedJob.appointmentUrl ? (
            <a href={selectedJob.appointmentUrl} target="_blank" rel="noreferrer">Open in JunkWare</a>
          ) : null}
        </div>
      </article>
    );
  };

  return (
    <section className="ops-card ops-jobs-map-card" id="jobs-map" aria-labelledby="jobs-map-title">
      <div className="ops-card-header compact ops-jobs-map-header">
        <div>
          <div className="ops-section-title" id="jobs-map-title">Dispatch Workspace</div>
          <div className="ops-muted">
            {scheduleView
              ? "Select a job for details. Use the Route assignment board to change its truck or time."
              : "Select a job to review the customer, service address, and closest truck."}
          </div>
        </div>
        <div className="ops-jobs-map-counts" aria-label="Map coverage">
          <strong>{mapCoverage.mapped}</strong> of {mapCoverage.total} mapped
          <span>{mapCoverage.percent}% coverage</span>
          {mapCoverage.needsVerification > 0 ? (
            <button
              type="button"
              className="ops-jobs-map-verify-toggle"
              aria-expanded={showAddressVerification}
              aria-controls="dispatch-address-verification"
              onClick={() => setShowAddressVerification((current) => !current)}
            >
              Verify {mapCoverage.needsVerification}
            </button>
          ) : <em>All verified</em>}
        </div>
      </div>

      {showAddressVerification && unlocatedJobs.length ? (
        <section className="ops-jobs-map-verification" id="dispatch-address-verification" aria-labelledby="dispatch-address-verification-title">
          <div className="ops-jobs-map-verification-heading">
            <div>
              <span>Map blocked</span>
              <strong id="dispatch-address-verification-title">Address verification queue</strong>
            </div>
            <small>{unlocatedJobs.length} job{unlocatedJobs.length === 1 ? "" : "s"}</small>
          </div>
          <div className="ops-jobs-map-verification-list">
            {unlocatedJobs.map((job) => (
              <article key={job.key}>
                <div>
                  <strong>{job.jkNumber && job.jkNumber !== "—" ? job.jkNumber : job.customerName}</strong>
                  <span>{job.address && job.address !== "—" ? job.address : "No service address recorded"}</span>
                  <small>{dispatchMapVerificationReason(job)}</small>
                </div>
                <div className="ops-jobs-map-verification-actions">
                  <button type="button" onClick={() => showAppointmentInQueue(job)}>Show card</button>
                  {job.appointmentUrl ? <a href={job.appointmentUrl} target="_blank" rel="noreferrer">Verify in JunkWare</a> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="ops-jobs-map-legend" aria-label="Map legend">
        <div className="ops-jobs-map-legend-row ops-jobs-map-legend-territories" aria-label="Focus map on territory">
          {DISPATCH_TERRITORY_SHORTCUTS.map((territory) => (
            <button
              type="button"
              className="ops-jobs-map-legend-territory"
              key={territory.label}
              onClick={() => focusTerritory(territory)}
              title={`Focus map on ${territory.label}`}
              aria-label={`Focus map on ${territory.label}`}
            ><i className={territory.tone} />{territory.abbreviation}</button>
          ))}
        </div>
        <div className="ops-jobs-map-legend-row ops-jobs-map-legend-status" aria-label="Appointment status">
          <span title="Truck GPS"><i className="is-truck" />GPS</span>
          <span><i className="is-visited-unclosed">?</i>Visited</span>
          <span><i className="is-completed">✓</i>Completed</span>
          <span><i className="is-canceled">×</i>Cancelled</span>
          <span
            className={linxupUpdateDelayed || !linxupUpdatedAt ? "is-delayed" : ""}
            title={linxupUpdatedAt ? `Latest Linxup GPS: ${linxupUpdatedAt}` : "Waiting for current Linxup GPS"}
          >
            <i className="is-on-site" />On Site
          </span>
        </div>
      </div>

      <div className={`ops-jobs-map-workspace${scheduleView ? " has-schedule" : ""}`}>
        <div className="ops-jobs-map-shell">
          <div ref={mapNodeRef} className="ops-jobs-leaflet-map" aria-label="Map of job locations" />
          {locatedJobs.length === 0 ? (
            <div className="ops-jobs-map-empty">No verified job locations are available for this view.</div>
          ) : null}

          {!scheduleView ? renderAppointmentDetails() : null}
        </div>

        {scheduleView ? (
          <section className="ops-jobs-route-board" aria-labelledby="route-assignment-board-title">
            <div className="ops-jobs-route-board-header">
              <span>
                <strong id="route-assignment-board-title">Route assignment board</strong>
                <small>Drag appointments to change truck or time</small>
              </span>
            </div>
            <aside className="ops-jobs-map-schedule" aria-label="Truck by time appointment schedule">
            <div
              className="ops-jobs-map-board"
              style={{
                // Keep every truck/time column inside the Dispatch pane. Hour
                // labels are compact and retain their expanded title/aria text.
                "--ops-jobs-map-time-cell-min": "0px",
                gridTemplateColumns: `${SCHEDULE_TRUCK_COLUMN_WIDTH}px repeat(${Math.max(scheduleTimeColumnCount, 1)}, minmax(var(--ops-jobs-map-time-cell-min), 1fr))`,
              } as CSSProperties}
            >
              {currentTimeLine ? (
                <div
                  className="ops-jobs-map-current-time"
                  style={{ left: currentTimeLine.left }}
                  title={`Current time · ${currentTimeLine.label}`}
                  aria-label={`Current time ${currentTimeLine.label}`}
                >
                  <span aria-hidden="true">{currentTimeLine.label.replace(/\s+[AP]M$/, "")}</span>
                </div>
              ) : null}
              <div className="ops-jobs-map-board-corner">Truck</div>
              {scheduleBoard.rows.map((hour) => (
                <div
                  className="ops-jobs-map-board-time"
                  key={`time-${hour}`}
                  title={compactHourLabel(hour)}
                  aria-label={compactHourLabel(hour)}
                >
                  {timelineHourLabel(hour)}
                </div>
              ))}
              {scheduleBoard.untimed ? <div className="ops-jobs-map-board-time">No time</div> : null}

              {scheduleTruckRows.map((column) => {
                const liveTruck = column.virtual
                  ? null
                  : liveTruckLocations.find((truck) => sameTruck(truck.truck, column.assignment)) || null;
                const rowClassName = `ops-jobs-map-board-truck is-row-label${column.virtual ? " is-virtual" : ""}${liveTruck ? " is-clickable" : ""}${liveTruck?.truck === selectedTruckName ? " is-selected" : ""}${dropTarget.startsWith(`${column.key}|`) ? " is-drop-target" : ""}`;
                const dropHandlers = scheduleDropHandlers(column);

                return <div className="ops-jobs-map-board-row" key={column.key}>
                  {liveTruck ? (
                    <button
                      type="button"
                      className={rowClassName}
                      data-schedule-drop-key={scheduleDropTargetKey(column)}
                      aria-label={`Show ${liveTruck.truck} on map`}
                      title={`Show ${liveTruck.truck} on map`}
                      onClick={() => selectLiveTruck(liveTruck.truck)}
                      {...dropHandlers}
                    >
                      {column.label}
                    </button>
                  ) : (
                    <div
                      className={rowClassName}
                      data-schedule-drop-key={scheduleDropTargetKey(column)}
                      {...dropHandlers}
                    >
                      {column.label}
                    </div>
                  )}
                  {scheduleBoard.rows.map((hour) => {
                    const appointments = scheduledJobs.filter((job) =>
                      scheduleBoard.jobColumns.get(job.key) === column.key
                      && job.appointmentStartMinutes != null
                      && Math.floor(job.appointmentStartMinutes / 60) === hour,
                    );
                    return (
                      <div
                        className={`ops-jobs-map-board-cell${dropTarget === scheduleDropTargetKey(column, hour * 60) ? " is-drop-target" : ""}`}
                        data-schedule-drop-key={scheduleDropTargetKey(column, hour * 60)}
                        key={`${column.key}-${hour}`}
                        {...scheduleDropHandlers(column, hour * 60)}
                      >
                        {appointments.map((job) => (
                          <button
                            type="button"
                            draggable={job.statusBucket !== "Canceled" && !pendingKeys.includes(job.key)}
                            className={`ops-jobs-map-board-block ${territoryTone(job)}${selectedKey === job.key ? " is-selected" : ""}${pendingKeys.includes(job.key) ? " is-saving" : ""}${draggedKey === job.key && dragGesture?.active ? " is-dragging" : ""}`}
                            onClick={() => handleAppointmentClick(job.key)}
                            onContextMenu={(event) => handleAppointmentContextMenu(event, job)}
                            onPointerDown={(event) => handleAppointmentPointerDown(event, job)}
                            onDragStart={(event) => handleAppointmentDragStart(event, job)}
                            onDragEnd={() => clearDragGesture()}
                            aria-label={`${job.appointmentTime}, ${job.customerName}, ${job.truck}, ${scheduleJobState(job).label}, ${job.junkItems.length ? `items: ${job.junkItems.join(", ")}` : "items not listed"}`}
                            title={`${job.appointmentTime} · ${job.customerName} · ${scheduleJobState(job).label} · ${job.junkItems.length ? job.junkItems.join(", ") : "Items not listed"}`}
                            key={job.key}
                          >
                            <ScheduleJobStateIcon job={job} />
                          </button>
                        ))}
                      </div>
                    );
                  })}
                  {scheduleBoard.untimed ? (() => {
                    const appointments = scheduledJobs.filter((job) =>
                      scheduleBoard.jobColumns.get(job.key) === column.key && job.appointmentStartMinutes == null,
                    );
                    return (
                      <div
                        className="ops-jobs-map-board-cell"
                        key={`${column.key}-untimed`}
                        title="Appointments without a scheduled time"
                      >
                        {appointments.map((job) => (
                          <button
                            type="button"
                            draggable={job.statusBucket !== "Canceled" && !pendingKeys.includes(job.key)}
                            className={`ops-jobs-map-board-block ${territoryTone(job)}${selectedKey === job.key ? " is-selected" : ""}${pendingKeys.includes(job.key) ? " is-saving" : ""}${draggedKey === job.key && dragGesture?.active ? " is-dragging" : ""}`}
                            onClick={() => handleAppointmentClick(job.key)}
                            onContextMenu={(event) => handleAppointmentContextMenu(event, job)}
                            onPointerDown={(event) => handleAppointmentPointerDown(event, job)}
                            onDragStart={(event) => handleAppointmentDragStart(event, job)}
                            onDragEnd={() => clearDragGesture()}
                            aria-label={`Unscheduled, ${job.customerName}, ${job.truck}, ${scheduleJobState(job).label}, ${job.junkItems.length ? `items: ${job.junkItems.join(", ")}` : "items not listed"}`}
                            title={`Unscheduled · ${job.customerName} · ${scheduleJobState(job).label} · ${job.junkItems.length ? job.junkItems.join(", ") : "Items not listed"}`}
                            key={job.key}
                          >
                            <ScheduleJobStateIcon job={job} />
                          </button>
                        ))}
                      </div>
                    );
                  })() : null}
                </div>;
              })}
            </div>
            </aside>
          </section>
        ) : null}

        {selectedTruck ? (
          <article ref={mapSelectionRef} className="ops-jobs-map-selection ops-jobs-map-truck-selection is-truck" aria-live="polite">
            <button type="button" className="ops-jobs-map-selection-close" onClick={() => setSelectedTruckName("")} aria-label="Close truck details">×</button>
            <div className="ops-jobs-map-selection-kicker">
              <span className="ops-jobs-map-selection-truck-icon" aria-hidden="true">🚚</span>
              Live truck
            </div>
            <strong className="ops-jobs-map-selection-customer">{selectedTruck.truck}</strong>
            <div className="ops-jobs-map-truck-details">
              <div><span>Driver</span><strong>{selectedTruck.driver && selectedTruck.driver !== "—" ? selectedTruck.driver : "Unassigned"}</strong></div>
              <div><span>Navigator</span><strong>{selectedTruck.navigator && selectedTruck.navigator !== "—" ? selectedTruck.navigator : "Unassigned"}</strong></div>
              <div>
                <span>Current address</span>
                <strong>
                  {selectedTruckAddress.loading
                    ? "Finding current street address…"
                    : selectedTruckAddress.address
                      ? selectedTruckAddress.address
                      : `${selectedTruckAddress.error || "Address unavailable"} · GPS ${selectedTruck.latitude.toFixed(5)}, ${selectedTruck.longitude.toFixed(5)}`}
                </strong>
              </div>
              <div><span>Truck status</span><strong>{selectedTruck.status}</strong></div>
              <div><span>GPS freshness</span><strong>{selectedTruck.freshness}</strong></div>
            </div>
            <div className="ops-jobs-map-route-history" aria-label={`${selectedTruck.truck} route taken today`}>
              <span className="ops-jobs-map-route-history-title">Route taken today</span>
              {selectedTruckRoutes.length ? (
                <ol>
                  {selectedTruckRoutes.map((segment, index) => (
                    <li key={segment.key}>
                      <i style={{ backgroundColor: segment.color }} aria-hidden="true" />
                      <strong>{segment.kind === "job" ? `${index + 1}. ${segment.label}` : segment.label}</strong>
                      <span>{routeTime(segment.points[0].timestamp)}–{routeTime(segment.points.at(-1)?.timestamp || "")}</span>
                    </li>
                  ))}
                </ol>
              ) : <span className="ops-jobs-map-route-history-empty">No driven GPS trail is available yet.</span>}
            </div>
            {selectedTruckCameraNumber ? (
              <button
                type="button"
                className="ops-jobs-map-truck-live-camera"
                data-truck-camera={selectedTruckCameraNumber}
                aria-label={`View live video for ${selectedTruck.truck}`}
              >
                <span aria-hidden="true">▶</span>
                View live video
              </button>
            ) : null}
          </article>
        ) : null}
      </div>

      <AppointmentCancelDialog
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onCanceled={(target) => {
          const canceledJob = displayJobs.find((job) => job.appointmentId === target.appointmentId);
          if (canceledJob) setCanceledKeys((current) => Array.from(new Set([...current, canceledJob.key])));
          setAssignmentMessage(`${target.jkNumber} was canceled and verified in JunkWare.`);
          router.refresh();
        }}
      />

      {dragGesture?.active ? (
        <div
          className="ops-jobs-map-drag-ghost"
          style={{ left: dragGesture.x, top: dragGesture.y }}
          aria-hidden="true"
        >
          {(() => {
            const target = scheduleDropTarget(dropTarget, scheduleBoard.columns);
            return target
              ? `Move to ${target.column.label}${target.startMinutes === undefined ? "" : ` at ${compactHourLabel(target.startMinutes / 60)}`}`
              : "Move to a truck and time";
          })()}
        </div>
      ) : null}

      {scheduleView ? (
        <div className={`ops-jobs-map-assignment-status${!selectedKey && !assignmentMessage ? " is-idle" : ""}`} aria-live="polite">
          {renderAppointmentDetails() || assignmentMessage || "Drag a block to change its truck or time. Right-click a block to cancel it in JunkWare."}
        </div>
      ) : null}

      {jobs.length > locatedJobs.length ? (
        <div className="ops-jobs-map-foot">
          {jobs.length - locatedJobs.length} {jobs.length - locatedJobs.length === 1 ? "job is" : "jobs are"} still listed in the schedule but cannot be placed until the service address is verified.
        </div>
      ) : null}
    </section>
  );
}
