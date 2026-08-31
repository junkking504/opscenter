import crypto from "crypto";
import fs from "fs";
import path from "path";
import { withAppointmentVisitConfirmations } from "@/lib/appointment-visit-confirmations";
import { AnyRecord, readMetrics } from "@/lib/opsData";
import { buildFleetDailyRecord } from "@/lib/fleet-history";
import {
  LINXUP_V3_AUTHORITY_MAX_AGE_SECONDS,
  selectAuthoritativeLinxupPoint,
  type LinxupDeliveryMode,
} from "@/lib/linxup-authority";
import { chicagoDateKey } from "@/lib/report-dates";

export type FleetMapPoint = {
  timestamp: string;
  trackerId: string | null;
  truck: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  ignition: string | null;
  heading: string | null;
  sourceRecordId: string | null;
  deliverySource: "v3_position_push" | "v2_poll";
  continuousUntil: string | null;
};

export type FleetMapStop = {
  kind: "At Job" | "At Yard" | "At Dump/Recycling" | "At Fuel" | "Unknown";
  label: string;
  truck: string;
  latitude: number;
  longitude: number;
  begin: string;
  end: string;
  source: string;
};

export type FleetTruckMapRecord = {
  truck: string;
  trackerId: string | null;
  vehicleName: string | null;
  yearMakeModel: string | null;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  ignition: string;
  heading: string | null;
  lastGpsUpdate: string | null;
  gpsDeliveryMode: LinxupDeliveryMode;
  gpsFallbackActive: boolean;
  latestV3PositionAt: string | null;
  freshnessLabel: string;
  operationalStatus: string;
  driver: string;
  navigator: string;
  crewMembers: string[];
  relatedAppointments: Array<{
    jkNumber: string;
    customer: string;
    time: string;
    status: string;
  }>;
  driverScore: number | null;
  driverScoreDisplay: string;
  driverScoreStatus: string;
  driverScoreWarning: string;
  scoreSource: string | null;
  confidence: string | null;
  currentOrHistoricalAppointment: string;
  milesDriven: number | null;
  odometer: string;
  driveTime: string;
  idleTime: string;
  jobsCompleted: number | null;
  estimates: number | null;
  totalSiteTimeMinutes: number | null;
  revenue: number | null;
  safetyAlerts: Array<{ label: string; value: number | null; available: boolean }>;
  alertEvents: Array<{
    alert_id: string | null;
    alert_type: string | null;
    alert_type_normalized: string | null;
    occurred_at: string | null;
    truck_number: string | null;
    vehicle_name: string | null;
    driver_name: string | null;
    driver_normalized_name: string | null;
    latitude: number | null;
    longitude: number | null;
    address: string | null;
    severity: string | null;
    speed: number | null;
    posted_speed: number | null;
    geofence_name: string | null;
    duration_seconds: number | null;
    video_available: boolean;
    video_id: string | null;
    attribution_status: string | null;
    source_status: string | null;
  }>;
  alertEventCount: number;
  alertCollectionStatus: string;
  serviceStatus: string;
  mileageUntilNextService: string;
  daysUntilNextService: string;
  routePoints: FleetMapPoint[];
  routeStops: FleetMapStop[];
  gpsStops: FleetMapStop[];
  hasCoordinates: boolean;
  mappingStatus: string;
  notes: string[];
};

export type FleetMapPayload = {
  date: string;
  isToday: boolean;
  viewMode: "daily";
  gpsDataStatus: string;
  lastUpdatedAt: string | null;
  staleThresholdMinutes: number;
  trucksWithCoordinates: number;
  trucksWithoutCoordinates: string[];
  routeHistoryAvailable: boolean;
  selectedTruck: string | null;
  selectedTruckRecord: FleetTruckMapRecord | null;
  trucks: FleetTruckMapRecord[];
  mappingWarnings: string[];
};

const STALE_THRESHOLD_MINUTES = 120;

type OperationalLocationCode = "NOHQ" | "BRHQ" | "GL" | "RBL" | "BRL" | "STS" | "GMTS" | "EMR";

const OPERATIONAL_LOCATIONS: Array<{
  code: OperationalLocationCode;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}> = [
  { code: "NOHQ", latitude: 29.9863006, longitude: -90.0586452, radiusMeters: 300 },
  { code: "BRHQ", latitude: 30.4191544, longitude: -91.1449730, radiusMeters: 300 },
  { code: "GL", latitude: 30.0064, longitude: -89.9766, radiusMeters: 750 },
  { code: "RBL", latitude: 29.9264, longitude: -90.2652, radiusMeters: 1_200 },
  { code: "BRL", latitude: 30.6025, longitude: -91.2341, radiusMeters: 750 },
  { code: "STS", latitude: 30.43145, longitude: -90.0388, radiusMeters: 350 },
  { code: "GMTS", latitude: 30.5119195, longitude: -91.1794450, radiusMeters: 350 },
  { code: "EMR", latitude: 29.9688, longitude: -90.0817, radiusMeters: 300 },
];

function roots(): string[] {
  return [
    process.cwd(),
    path.join(process.cwd(), "..", "opsbot"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot"),
  ];
}

function resolveHistoryPath(relativePath: string): string | null {
  const clean = String(relativePath || "").replace(/^\/+/, "");
  if (!clean) return null;
  for (const root of roots()) {
    const candidate = path.join(root, clean);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readJsonFile<T = AnyRecord>(relativePath: string): T | null {
  const resolved = resolveHistoryPath(relativePath);
  if (!resolved) return null;
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as T;
  } catch {
    return null;
  }
}

function normalizeTruckLabel(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/(\d+)/);
  return match ? `Truck# ${match[1]}` : raw.replace(/\s+/g, " ");
}

function isRealTruckLabel(value: unknown): boolean {
  return /^Truck#?\s*\d+$/i.test(normalizeTruckLabel(value));
}

function normalizePersonName(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const comma = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (comma.length === 2) return `${comma[1]} ${comma[0]}`;
  return raw.replace(/\s+/g, " ");
}

function moneyNumber(value: unknown): number {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function normalizeAddress(value: string): string {
  return String(value || "").replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim().toUpperCase();
}

function addressHash(address: string): string {
  return crypto.createHash("sha256").update(normalizeAddress(address)).digest("hex");
}

function loadGeocodeCache(): Record<string, AnyRecord> {
  const payload = readJsonFile<AnyRecord>("data/cache/appointment_geocodes.json");
  return payload && typeof payload.addresses === "object" ? (payload.addresses as Record<string, AnyRecord>) : {};
}

function geocodeForAddress(address: string): AnyRecord | null {
  const cache = loadGeocodeCache();
  const hashed = addressHash(address);
  const entry = cache[hashed];
  if (!entry) return null;
  return entry;
}

function loadVehicleMap(): AnyRecord {
  return readJsonFile<AnyRecord>("data/config/linxup_vehicle_map.json") || { mappings: [], unresolved: {} };
}

function loadLocationPayload(date: string): AnyRecord | null {
  const rel = path.join("data", "history", "linxup", `linxup_location_${date}.json`);
  return readJsonFile<AnyRecord>(rel);
}

function loadAppointmentVisits(date: string): AnyRecord[] {
  const rel = path.join("data", "history", "linxup", "appointment_visits", `linxup_appointment_visits_${date}.json`);
  const payload = readJsonFile<AnyRecord>(rel);
  const visits = Array.isArray(payload?.visits) ? payload.visits : [];
  return withAppointmentVisitConfirmations(visits, date);
}

function loadDaily(date: string) {
  return buildFleetDailyRecord(date);
}

function toMinutesText(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const total = Math.round(value);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
}

function toScoreText(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

function toOdometerText(point: AnyRecord | null): string {
  const odo = point?.trueOdo ?? point?.virtualOdo ?? point?.estimatedOdo;
  if (odo == null || Number.isNaN(Number(odo))) return "—";
  return Number(odo).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function latestPoint(points: AnyRecord[]): AnyRecord | null {
  if (!points.length) return null;
  return [...points].sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")))[points.length - 1] ?? null;
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

function operationalLocationCodeFromName(value: unknown): OperationalLocationCode | null {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  const directCode = raw.toUpperCase().replace(/\s+/g, "");
  if (["NOHQ", "BRHQ", "GL", "RBL", "BRL", "STS", "GMTS", "EMR"].includes(directCode)) {
    return directCode as OperationalLocationCode;
  }
  const name = raw.toLowerCase();
  if (!name) return null;
  if (/^warehouse$|new orleans.*(warehouse|hq)|\bno\s*hq\b/.test(name)) return "NOHQ";
  if (/baton rouge.*(warehouse|hq)|\bbr\s*hq\b/.test(name)) return "BRHQ";
  if (/gentilly/.test(name)) return "GL";
  if (/river\s*birch|riverbirch|jefferson parish landfill/.test(name)) return "RBL";
  if (/br landfill|baton rouge landfill/.test(name)) return "BRL";
  if (/stranco/.test(name)) return "STS";
  if (/green meadow|mengel/.test(name)) return "GMTS";
  if (/\bemr\b/.test(name)) return "EMR";
  return null;
}

function operationalLocationCodeAt(point: { latitude: number; longitude: number }): OperationalLocationCode | null {
  return OPERATIONAL_LOCATIONS.find((location) => distanceMeters(point, location) <= location.radiusMeters)?.code || null;
}

export function classifyOperationalStatus({
  latest,
  routeStops,
  routePoints,
}: {
  latest: AnyRecord | null;
  routeStops: FleetMapStop[];
  routePoints: FleetMapPoint[];
}): string {
  if (!latest && !routePoints.length) return "Unknown";
  const latestLocation = latest && Number.isFinite(Number(latest.latitude)) && Number.isFinite(Number(latest.longitude))
    ? { latitude: Number(latest.latitude), longitude: Number(latest.longitude) }
    : null;
  // Appointment visits are historical evidence: a visit's recorded departure
  // must never be reclassified as a current job merely because a later GPS
  // point is close to the same address. Current on-site status is established
  // separately from fresh, continuous GPS dwell in Dispatch.
  const currentStop = latestLocation
    ? [...routeStops]
        .reverse()
        .find((stop) => stop.kind !== "Unknown" && stop.kind !== "At Job" && distanceMeters(latestLocation, stop) <= 150)
    : null;
  const namedLocationCode = operationalLocationCodeFromName(currentStop?.label);
  if (namedLocationCode) return namedLocationCode;
  const coordinateLocationCode = latestLocation && Number(latest?.speed || 0) <= 15
    ? operationalLocationCodeAt(latestLocation)
    : null;
  if (coordinateLocationCode) return coordinateLocationCode;
  if (latest && Number(latest.speed || 0) > 0) return "Driving";
  if (currentStop) return currentStop.kind;
  if (latest && Number(latest.speed || 0) === 0) return "Idle";
  return "Unknown";
}

export function operationalStatusForFreshness(status: string, freshness: string): string {
  if (freshness === "GPS Stale") return "GPS Stale";
  if (freshness === "Offline") return "Offline";
  return status;
}

function freshnessLabel({
  hasPayload,
  latestTimestamp,
  selectedDate,
}: {
  hasPayload: boolean;
  latestTimestamp: string | null;
  selectedDate: string;
}): string {
  if (!hasPayload) return "GPS history unavailable";
  if (!latestTimestamp) return "GPS unavailable";
  if (selectedDate !== chicagoDateKey()) return "Historical GPS";
  const ageMinutes = (Date.now() - new Date(latestTimestamp).getTime()) / 60000;
  if (ageMinutes <= 15) return "Live GPS";
  if (ageMinutes <= STALE_THRESHOLD_MINUTES) return "GPS Stale";
  return "Offline";
}

function supportedStopKind(stop: AnyRecord): FleetMapStop["kind"] | null {
  const geofence = String(stop?.geofenceName || "").toLowerCase();
  const locationCode = operationalLocationCodeFromName(geofence);
  if (locationCode === "NOHQ" || locationCode === "BRHQ") return "At Yard";
  if (locationCode) return "At Dump/Recycling";
  if (/warehouse|yard/.test(geofence)) return "At Yard";
  if (/landfill|transfer|dump|recycl/.test(geofence)) return "At Dump/Recycling";
  if (/fuel|gas/.test(geofence)) return "At Fuel";
  return null;
}

function truckAppointmentSummary(appointments: AnyRecord[]): {
  driver: string;
  navigator: string;
  crewMembers: string[];
  relatedAppointments: FleetTruckMapRecord["relatedAppointments"];
  summary: string;
} {
  const drivers = Array.from(new Set(appointments.map((row) => normalizePersonName(row.driver)).filter(Boolean)));
  const navigators = Array.from(new Set(appointments.map((row) => normalizePersonName(row.navigator || row.crew)).filter(Boolean)));
  const crewMembers = Array.from(new Set([...drivers, ...navigators]));
  const relatedAppointments = appointments.flatMap((row) => {
    const jkNumber = String(row.job_id || row.jk_number || "").trim();
    if (!jkNumber) return [];
    return [{
      jkNumber,
      customer: String(row.customer_name || row.customer || "Customer unavailable").trim(),
      time: String(row.appointment_time || row.time || "Time unavailable").trim(),
      status: String(row.job_status || row.appointment_status || row.status || "Status unavailable").trim(),
    }];
  });
  const first = appointments[0] || null;
  const summary =
    appointments.length === 0
      ? "—"
      : appointments.length === 1
        ? `${first?.job_id || first?.jk_number || "Appointment"} · ${first?.appointment_time || "Time unavailable"}`
        : `${first?.job_id || first?.jk_number || "Appointment"} and ${appointments.length - 1} more`;
  return {
    driver: drivers.length === 0 ? "—" : drivers.length === 1 ? drivers[0] : "Multiple",
    navigator: navigators.length === 0 ? "—" : navigators.length === 1 ? navigators[0] : "Multiple",
    crewMembers,
    relatedAppointments,
    summary,
  };
}

function buildRouteStops({
  date,
  truck,
  appointments,
  visits,
}: {
  date: string;
  truck: string;
  appointments: AnyRecord[];
  visits: AnyRecord[];
}): FleetMapStop[] {
  const points: FleetMapStop[] = [];
  const appointmentById = new Map<string, AnyRecord>();
  const appointmentByJk = new Map<string, AnyRecord>();
  for (const appt of appointments) {
    if (appt.appt_id != null) appointmentById.set(String(appt.appt_id), appt);
    if (appt.job_id != null) appointmentByJk.set(String(appt.job_id), appt);
  }
  for (const visit of visits) {
    if (normalizeTruckLabel(visit.truck_number || visit.truck || visit.truckNumber) !== truck) continue;
    if (Number(visit.visit_count || 0) <= 0 && !visit.operational_confirmation) continue;
    const appt = appointmentById.get(String(visit.appointment_id || "")) || appointmentByJk.get(String(visit.jk_number || ""));
    if (!appt) continue;
    const geocode = geocodeForAddress(String(appt.service_address || appt.address || ""));
    if (!geocode || geocode.latitude == null || geocode.longitude == null) continue;
    points.push({
      kind: "At Job",
      label: String(appt.job_id || appt.jk_number || "Appointment"),
      truck,
      latitude: Number(geocode.latitude),
      longitude: Number(geocode.longitude),
      begin: String(visit.first_arrival || visit.begin || ""),
      end: String(visit.final_departure || visit.end || ""),
      source: "appointment_visit",
    });
  }
  return points;
}

function buildTruckRecord({
  date,
  selectedDateIsToday,
  truck,
  daily,
  locationPayload,
  vehicleMap,
}: {
  date: string;
  selectedDateIsToday: boolean;
  truck: string;
  daily: ReturnType<typeof buildFleetDailyRecord>;
  locationPayload: AnyRecord | null;
  vehicleMap: AnyRecord;
}): FleetTruckMapRecord {
  const allAppointments = daily?.appointments || [];
  const truckAppointments = allAppointments.filter((row) => normalizeTruckLabel(row.truck || row.assigned_truck) === truck);
  const truckScores = daily?.truckScoreRows || [];
  const scoreRow = truckScores.find((row) => normalizeTruckLabel(row.truck) === truck) || null;
  const truckRows = daily?.truckRows || [];
  const financialRow = truckRows.find((row) => normalizeTruckLabel(row.truck) === truck) || null;
  const normalizedMap = Array.isArray(vehicleMap.mappings) ? vehicleMap.mappings : [];
  const mapEntry = normalizedMap.find((row: AnyRecord) => normalizeTruckLabel(row?.junkware_truck_number) === truck) || null;
  const rawPoints = Array.isArray(locationPayload?.points) ? locationPayload.points : [];
  const truckPoints = rawPoints
    .filter((row) => normalizeTruckLabel(row.truck_number || row.truck || row.truckNumber) === truck)
    .map((row) => ({
      timestamp: String(row.timestamp || ""),
      trackerId: row.tracker_id ? String(row.tracker_id) : null,
      truck,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      speed: row.speed == null ? null : Number(row.speed),
      ignition: row.ignition_state ? String(row.ignition_state) : null,
      heading: row.heading ? String(row.heading) : null,
      sourceRecordId: row.source_record_id ? String(row.source_record_id) : null,
      deliverySource: String(row.delivery_source || "").toLowerCase() === "v3_position_push"
        || String(row.source_record_id || "").toLowerCase().startsWith("v3-position-")
        ? "v3_position_push" as const
        : "v2_poll" as const,
      continuousUntil: row.continuous_until ? String(row.continuous_until) : null,
    }))
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude !== 0 && point.longitude !== 0)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const authority = selectAuthoritativeLinxupPoint(
    truckPoints,
    Date.now(),
    Number(process.env.OPSCENTER_LINXUP_V3_MAX_AGE_SECONDS || LINXUP_V3_AUTHORITY_MAX_AGE_SECONDS),
  );
  const lastPoint = authority.point;
  const gpsStops = (Array.isArray(locationPayload?.stops)
    ? locationPayload.stops
        .filter((row) => normalizeTruckLabel(row.driverName || row.firstName || row.personName) === truck)
        .map((row) => {
          if (row.latitude == null || row.longitude == null) return null;
          const kind = supportedStopKind(row) || "Unknown";
          return {
            kind,
            label: operationalLocationCodeFromName(row.geofenceName) || String(row.geofenceName || row.street || kind),
            truck,
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            begin: row.beginDate ? new Date(Number(row.beginDate)).toISOString() : "",
            end: row.endDate ? new Date(Number(row.endDate)).toISOString() : "",
            source: "linxup_stop",
          } as FleetMapStop;
        })
        .filter(Boolean)
    : []) as FleetMapStop[];
  const routeStops = [
    ...buildRouteStops({ date, truck, appointments: allAppointments, visits: loadAppointmentVisits(date) }),
    ...gpsStops.filter((stop) => stop.kind !== "Unknown"),
  ];

  const selectedAppointmentSummary = truckAppointmentSummary(truckAppointments);
  const validation = daily?.truckScoreRows?.find((row) => normalizeTruckLabel(row.truck) === truck) || null;
  const alerts = validation?.driver_alerts && typeof validation.driver_alerts === "object" ? validation.driver_alerts : null;
  const rawDriverScore = Number(scoreRow?.driver_score ?? scoreRow?.opscenter_driving_score ?? validation?.driver_score ?? NaN);
  const safetyAlerts = alerts
    ? Object.values(alerts).map((entry: any) => ({
        label: String(entry?.label || "Alert"),
        value: entry?.value == null ? null : Number(entry.value),
        available: Boolean(entry?.available),
      }))
    : [
      { label: "Speeding", value: Number(validation?.speeding_events || 0), available: true },
      { label: "Severe Speeding", value: Number(validation?.severe_speeding_events || 0), available: true },
        {
          label: "Harsh Braking",
          value:
            validation?.hard_braking_events ?? validation?.hardBrakingEvents ?? scoreRow?.hard_braking_events ?? scoreRow?.hardBrakingEvents ?? null,
          available:
            validation?.hard_braking_events != null ||
            validation?.hardBrakingEvents != null ||
            scoreRow?.hard_braking_events != null ||
            scoreRow?.hardBrakingEvents != null,
        },
        { label: "Hard Acceleration", value: null, available: false },
        { label: "Harsh Cornering", value: null, available: false },
        { label: "No Seatbelts", value: null, available: false },
        { label: "Tailgating", value: null, available: false },
        { label: "After-Hours Driving", value: Number(validation?.after_hours_events || 0), available: true },
      ];

  const latestTimestamp = lastPoint?.timestamp || locationPayload?.collection_timestamp || null;
  const freshness = freshnessLabel({
    hasPayload: Boolean(locationPayload),
    latestTimestamp,
    selectedDate: date,
  });
  const lastReportedOperationalStatus = classifyOperationalStatus({
    latest: lastPoint,
    routeStops,
    routePoints: truckPoints,
  });
  const freshnessStatus = freshness === "Historical GPS" ? "GPS Stale" : freshness;
  const operationalStatus = selectedDateIsToday
    ? operationalStatusForFreshness(lastReportedOperationalStatus, freshness)
    : lastReportedOperationalStatus;

  const notes = [
    ...(validation?.confidence_status && String(validation.confidence_status).toLowerCase() !== "confirmed"
      ? [String(validation.confidence_status)]
      : []),
    ...(Array.isArray(validation?.data_quality_notes) ? validation.data_quality_notes.map(String) : []),
    ...(mapEntry?.status === "unmapped" ? ["Unmapped truck mapping"] : []),
  ];

  return {
    truck,
    trackerId: mapEntry?.linxup_tracker_id || lastPoint?.trackerId || null,
    vehicleName: mapEntry?.linxup_vehicle_name || lastPoint?.truck || null,
    yearMakeModel:
      lastPoint?.timestamp && (lastPoint as AnyRecord).make && (lastPoint as AnyRecord).model
        ? `${(lastPoint as AnyRecord).year || ""} ${(lastPoint as AnyRecord).make || ""} ${(lastPoint as AnyRecord).model || ""}`.trim()
        : "—",
    latitude: lastPoint?.latitude ?? null,
    longitude: lastPoint?.longitude ?? null,
    speed: lastPoint?.speed ?? null,
    ignition:
      lastPoint?.speed != null && Number(lastPoint.speed) > 0
        ? "On"
        : routeStops.length > 0
          ? "Off"
          : "Unavailable",
    heading: lastPoint?.heading ?? null,
    lastGpsUpdate: latestTimestamp,
    gpsDeliveryMode: authority.mode,
    gpsFallbackActive: authority.fallbackActive,
    latestV3PositionAt: authority.latestV3PositionAt,
    freshnessLabel: freshnessStatus,
    operationalStatus,
    driver: selectedAppointmentSummary.driver || normalizePersonName(scoreRow?.assigned_driver || validation?.assigned_driver || ""),
    navigator: selectedAppointmentSummary.navigator || "—",
    crewMembers: selectedAppointmentSummary.crewMembers,
    relatedAppointments: selectedAppointmentSummary.relatedAppointments,
    driverScore: rawDriverScore,
    driverScoreDisplay:
      String(scoreRow?.driver_score_display || validation?.driver_score_display || "").trim()
      || (Number.isFinite(rawDriverScore) ? rawDriverScore.toFixed(1) : "Unavailable"),
    driverScoreStatus: String(scoreRow?.driver_score_status || validation?.driver_score_status || validation?.confidence_status || "Unavailable"),
    driverScoreWarning: String(scoreRow?.driver_score_warning || validation?.driver_score_warning || "").trim(),
    scoreSource: String(scoreRow?.driver_score_source || validation?.driver_score_source || "Unavailable"),
    confidence: String(scoreRow?.confidence_status || validation?.confidence_status || "Unknown"),
    currentOrHistoricalAppointment: selectedAppointmentSummary.summary,
    milesDriven: Number(scoreRow?.miles_driven ?? validation?.miles_driven ?? financialRow?.miles ?? NaN),
    odometer: toOdometerText(lastPoint),
    driveTime: scoreRow?.drive_time || validation?.drive_time || toMinutesText(Number(scoreRow?.drive_minutes ?? validation?.drive_minutes ?? NaN)),
    idleTime: scoreRow?.idle_time || validation?.idle_time || toMinutesText(Number(scoreRow?.idle_minutes ?? validation?.idle_minutes ?? NaN)),
    jobsCompleted: Number(financialRow?.jobs ?? NaN),
    estimates: Array.isArray(truckAppointments)
      ? truckAppointments.filter((row) => String(row.appointment_type || row.type || "").toLowerCase().includes("estimate")).length
      : null,
    totalSiteTimeMinutes: loadAppointmentVisits(date)
      .filter((visit) => normalizeTruckLabel(visit.truck_number || visit.truck || visit.truckNumber) === truck)
      .reduce((sum, visit) => sum + Number(visit.onsite_minutes || 0), 0),
    revenue: Number(financialRow?.revenue ?? scoreRow?.revenue ?? NaN),
    safetyAlerts,
    alertEvents: Array.isArray(validation?.alert_events)
      ? validation.alert_events
      : Array.isArray(scoreRow?.alert_events)
        ? scoreRow.alert_events
        : [],
    alertEventCount:
      Number(validation?.alert_event_count ?? scoreRow?.alert_event_count ?? 0) || (Array.isArray(validation?.alert_events) ? validation.alert_events.length : Array.isArray(scoreRow?.alert_events) ? scoreRow.alert_events.length : 0),
    alertCollectionStatus: String(validation?.alert_collection_status || scoreRow?.alert_collection_status || "Unavailable"),
    serviceStatus: "Unavailable",
    mileageUntilNextService: "—",
    daysUntilNextService: "—",
    routePoints: truckPoints,
    routeStops,
    gpsStops,
    hasCoordinates: Boolean(lastPoint),
    mappingStatus: mapEntry?.status === "active" ? "Mapped" : "Unmapped",
    notes,
  };
}

export function buildFleetMapPayload(date: string, selectedTruckRaw?: string | null): FleetMapPayload | null {
  const daily = loadDaily(date);
  if (!daily) return null;
  const locationPayload = loadLocationPayload(date);
  const vehicleMap = loadVehicleMap();
  const selectedDateIsToday = date === chicagoDateKey();
  const truckSet = new Set<string>();
  for (const row of daily.truckScoreRows || []) if (isRealTruckLabel(row.truck)) truckSet.add(normalizeTruckLabel(row.truck));
  for (const row of daily.truckRows || []) if (isRealTruckLabel(row.truck)) truckSet.add(normalizeTruckLabel(row.truck));
  for (const row of daily.appointments || []) {
    const label = normalizeTruckLabel(row.truck || row.assigned_truck);
    if (isRealTruckLabel(label)) truckSet.add(label);
  }
  for (const point of Array.isArray(locationPayload?.points) ? locationPayload.points : []) {
    const label = normalizeTruckLabel(point.truck_number || point.truck || point.truckNumber);
    if (isRealTruckLabel(label)) truckSet.add(label);
  }
  const trucks = Array.from(truckSet).filter(Boolean).sort((a, b) => a.localeCompare(b));

  const truckRecords = trucks.map((truck) =>
    buildTruckRecord({
      date,
      selectedDateIsToday,
      truck,
      daily,
      locationPayload,
      vehicleMap,
    })
  );

  const selectedTruck =
    normalizeTruckLabel(selectedTruckRaw) ||
    truckRecords.find((record) => record.hasCoordinates)?.truck ||
    truckRecords[0]?.truck ||
    null;

  const selectedTruckRecord = selectedTruck ? truckRecords.find((record) => record.truck === selectedTruck) || null : null;

  const trucksWithCoordinates = truckRecords.filter((record) => record.hasCoordinates).length;
  const trucksWithoutCoordinates = truckRecords.filter((record) => !record.hasCoordinates).map((record) => record.truck);
  const routeHistoryAvailable = Boolean(locationPayload?.points?.length || locationPayload?.trips?.length || locationPayload?.stops?.length || locationPayload?.ignition_events?.length);

  const lastUpdatedAt = locationPayload?.collection_timestamp
    || latestPoint((Array.isArray(locationPayload?.points) ? locationPayload.points : []) as AnyRecord[])?.timestamp
    || null;
  const gpsDataStatus =
    !locationPayload
      ? "GPS history unavailable"
      : trucksWithCoordinates === 0
        ? "GPS history unavailable"
        : trucksWithCoordinates < truckRecords.length
          ? "Partial GPS"
          : selectedDateIsToday
            ? "Live GPS"
            : "Historical GPS";

  const mappingWarnings = [
    ...(Array.isArray(vehicleMap?.unresolved?.junkware_trucks_without_verified_trackers)
      ? vehicleMap.unresolved.junkware_trucks_without_verified_trackers.map((truck: string) => `Unmapped truck: ${truck}`)
      : []),
    ...(Array.isArray(vehicleMap?.unresolved?.linxup_vehicle_names_without_verified_truck_mapping)
      ? vehicleMap.unresolved.linxup_vehicle_names_without_verified_truck_mapping.map((name: string) => `Unmapped Linxup vehicle: ${name}`)
      : []),
  ];

  return {
    date,
    isToday: selectedDateIsToday,
    viewMode: "daily",
    gpsDataStatus,
    lastUpdatedAt,
    staleThresholdMinutes: STALE_THRESHOLD_MINUTES,
    trucksWithCoordinates,
    trucksWithoutCoordinates,
    routeHistoryAvailable,
    selectedTruck,
    selectedTruckRecord,
    trucks: truckRecords,
    mappingWarnings,
  };
}
