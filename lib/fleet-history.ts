import fs from "fs";
import path from "path";
import { AnyRecord, availableDates, readMetrics } from "@/lib/opsData";

export type FleetSourceFlags = {
  appointments: boolean;
  completedJobs: boolean;
  revenue: boolean;
  crewAssignments: boolean;
  driverAssignments: boolean;
  linxupTrips: boolean;
  linxupMileage: boolean;
  linxupAlerts: boolean;
  driverScores: boolean;
  maintenanceData: boolean;
};

export type FleetDailyRecord = {
  date: string;
  revenue: number | null;
  activeTrucks: number | null;
  trucksUsed: number | null;
  jobsCompleted: number | null;
  estimates: number | null;
  totalMiles: number | null;
  averageMilesPerActiveTruck: number | null;
  driveTimeMinutes: number | null;
  idleTimeMinutes: number | null;
  totalSiteTimeMinutes: number | null;
  averageSiteTimePerJob: number | null;
  driversScored: number | null;
  averageDriverScore: number | null;
  speedingEvents: number | null;
  severeSpeedingEvents: number | null;
  hardBrakingEvents: number | null;
  afterHoursEvents: number | null;
  trucksDueForService: number | null;
  trucksWithWarnings: number | null;
  gpsDataStatus: string;
  gpsCoverage: boolean;
  mileageCoverage: boolean;
  alertCoverage: boolean;
  sourceFlags: FleetSourceFlags;
  sourceNotes: string[];
  trucksUsedList: string[];
  activeTruckList: string[];
  visits: AnyRecord[];
  truckRows: AnyRecord[];
  truckScoreRows: AnyRecord[];
  employeeScoreRows: AnyRecord[];
  navigatorScoreRows: AnyRecord[];
  appointments: AnyRecord[];
};

export type DriverHistoryRow = {
  name: string;
  daysAssigned: number;
  trucks: string[];
  milesDriven: number;
  driveTimeMinutes: number;
  idleTimeMinutes: number;
  averageDriverScore: number | null;
  driverScoreDisplay: string;
  driverScoreStatus: string;
  driverScoreWarning: string;
  driverScoreSource: string;
  bestScore: number | null;
  lowestScore: number | null;
  speedingEvents: number;
  severeSpeedingEvents: number;
  hardBrakingEvents: number | null;
  afterHoursEvents: number;
  confirmedDays: number;
  partialOrAmbiguousDays: number;
  eligibleDays: number;
  ineligibleDays: number;
  days: AnyRecord[];
};

export type TruckHistoryRow = {
  truck: string;
  daysUsed: number;
  jobsCompleted: number;
  revenue: number;
  miles: number;
  driveTimeMinutes: number;
  idleTimeMinutes: number;
  siteTimeMinutes: number;
  drivers: string[];
  averageDriverScore: number | null;
  driverScoreDisplay: string;
  driverScoreStatus: string;
  driverScoreWarning: string;
  driverScoreSource: string;
  speedingEvents: number;
  severeSpeedingEvents: number;
  hardBrakingEvents: number | null;
  afterHoursEvents: number;
  safetyEvents: number;
  currentOdometer: string;
  serviceStatus: string;
  lastGpsDate: string;
  days: AnyRecord[];
};

export type JulyFleetSummary = {
  dates: FleetDailyRecord[];
  coverageDays: number;
  totalRevenue: number;
  totalCompletedJobs: number;
  uniqueTrucksUsed: number;
  totalMilesRecorded: number | null;
  averageDailyActiveTrucks: number | null;
  totalDriveTimeMinutes: number | null;
  totalIdleTimeMinutes: number | null;
  averageDriverScore: number | null;
  totalSpeedingEvents: number | null;
  totalSevereSpeedingEvents: number | null;
  totalHardBrakingEvents: number | null;
  totalAfterHoursEvents: number | null;
  trucksCurrentlyDueForService: number | null;
  sortKey: FleetSortKey;
  sortDirection: FleetSortDirection;
  driverRows: DriverHistoryRow[];
  truckRows: TruckHistoryRow[];
  sourceAuditRows: FleetDailyRecord[];
};

export type FleetSortKey = "date" | "revenue" | "jobs" | "miles" | "driverScore";
export type FleetSortDirection = "asc" | "desc";

type SummaryParams = {
  sortKey?: FleetSortKey;
  sortDirection?: FleetSortDirection;
};

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

function moneyNumber(value: unknown): number {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function numberFrom(row: AnyRecord, keys: string[]): number {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== "") {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }
  return 0;
}

type DriverScoreDetail = {
  score: number | null;
  display: string;
  status: string;
  warning: string;
  effectiveMiles: number;
  safetyScore: number | null;
  idleScore: number | null;
  idlePercentage: number | null;
  alertCounts: Record<string, number | null>;
  alertAvailability: Record<string, boolean>;
  alertDeductions: Record<string, number>;
  speedingPenalty: number | null;
  severeSpeedingPenalty: number | null;
  afterHoursPenalty: number | null;
  source: string;
};

const AI_CAMERA_TRUCKS = new Set(["Truck# 3", "Truck# 4", "Truck# 8"]);
const ALERT_DEDUCTION_RULES: Record<string, { perEvent: number; dailyCap: number }> = {
  highSpeed: { perEvent: 8, dailyCap: 24 },
  rapidAcceleration: { perEvent: 1, dailyCap: 5 },
  harshBraking: { perEvent: 2, dailyCap: 10 },
  postedSpeed: { perEvent: 4, dailyCap: 20 },
  phoneUse: { perEvent: 10, dailyCap: 30 },
  tailgating: { perEvent: 5, dailyCap: 15 },
};

function alertTypeCounts(metrics: AnyRecord): Map<string, number> {
  const counts = new Map<string, number>();
  const alerts = Array.isArray(metrics?.alert_events)
    ? metrics.alert_events
    : Array.isArray(metrics?.alert_details)
      ? metrics.alert_details
      : [];

  for (const alert of alerts) {
    const type = String(alert?.alert_type || alert?.alert_type_normalized || "").trim().toUpperCase();
    if (!type) continue;
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return counts;
}

function alertRecords(metrics: AnyRecord): AnyRecord[] {
  if (Array.isArray(metrics?.alert_events)) return metrics.alert_events;
  if (Array.isArray(metrics?.alert_details)) return metrics.alert_details;
  return [];
}

function sumAlertTypes(counts: Map<string, number>, types: string[]): number {
  return types.reduce((sum, type) => sum + (counts.get(type) || 0), 0);
}

function highSpeedAlertsOver70(metrics: AnyRecord, alerts: AnyRecord[]): { count: number; verified: boolean } {
  const highSpeedIds = new Set(
    alerts
      .filter((alert) => String(alert?.alert_type || "").toUpperCase() === "HIGH_SPEED")
      .map((alert) => String(alert?.alert_id || ""))
      .filter(Boolean)
  );
  if (highSpeedIds.size === 0) return { count: 0, verified: true };

  const date = String(metrics?.date || "").slice(0, 10);
  if (!date) return { count: 0, verified: false };
  const payload = readJsonFile<AnyRecord>(
    path.join("data", "history", "linxup", "alerts", `linxup_alerts_${date}.json`)
  );
  const sourceAlerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
  if (sourceAlerts.length === 0) return { count: 0, verified: false };

  let count = 0;
  let matched = 0;
  for (const alert of sourceAlerts) {
    if (!highSpeedIds.has(String(alert?.alert_id || ""))) continue;
    matched += 1;
    const numericSpeed = Number(alert?.speed);
    const description = String(alert?.alert_desc || alert?.alertDesc || "");
    const descriptionSpeed = Number(description.match(/traveling\s+(\d+(?:\.\d+)?)\s+mph/i)?.[1]);
    const speed = Number.isFinite(numericSpeed) && numericSpeed > 0 ? numericSpeed : descriptionSpeed;
    if (Number.isFinite(speed) && speed > 70) count += 1;
  }

  return { count, verified: matched > 0 };
}

function computeWeightedAlertSafetyScore(metrics: AnyRecord): {
  score: number;
  counts: Record<string, number | null>;
  availability: Record<string, boolean>;
  deductions: Record<string, number>;
} {
  const rawCounts = alertTypeCounts(metrics);
  const rawAlerts = alertRecords(metrics);
  const trucks = [
    normalizeTruckLabel(metrics?.truck),
    ...(Array.isArray(metrics?.trucks_driven) ? metrics.trucks_driven.map(normalizeTruckLabel) : []),
  ].filter(Boolean);
  const aiCamera = trucks.some((truck) => AI_CAMERA_TRUCKS.has(truck));
  const alertsCollected = String(metrics?.alert_collection_status || "").toLowerCase() === "passed";
  const detailsAvailable = rawCounts.size > 0;
  const standardAvailable = alertsCollected || detailsAvailable;
  const driverAlerts = metrics?.driver_alerts || {};

  const verifiedHighSpeed = highSpeedAlertsOver70(metrics, rawAlerts);
  const highSpeed = verifiedHighSpeed.count;
  const postedSpeed = detailsAvailable
    ? sumAlertTypes(rawCounts, ["SPEEDING", "GEOFENCE_SPEEDING"])
    : Math.max(0, numberFrom(metrics, ["severe_speeding_events", "severeSpeedingEvents"]));
  const rapidAcceleration = detailsAvailable
    ? sumAlertTypes(rawCounts, ["RAPID_ACCELERATION", "HARD_ACCELERATION", "HARSH_ACCELERATION"])
    : Math.max(0, numberFrom(metrics, ["hard_acceleration_events", "rapid_acceleration_events"]));
  const harshBraking = detailsAvailable
    ? sumAlertTypes(rawCounts, ["HARSH_BRAKING"])
    : Math.max(0, numberFrom(metrics, ["hard_braking_events", "harsh_braking_events"]));
  const phoneUse = sumAlertTypes(rawCounts, ["PHONE_USE", "PHONE_IN_USE", "CELL_PHONE_USE"]);
  const tailgating = detailsAvailable
    ? sumAlertTypes(rawCounts, ["TAILGATING", "FOLLOWING_TOO_CLOSELY"])
    : Math.max(0, numberFrom(metrics, ["tailgating_events"]));

  const availability: Record<string, boolean> = {
    highSpeed: standardAvailable && verifiedHighSpeed.verified,
    rapidAcceleration: standardAvailable || driverAlerts?.hard_acceleration?.available === true,
    harshBraking: standardAvailable || driverAlerts?.hard_braking?.available === true,
    postedSpeed: standardAvailable || driverAlerts?.severe_speeding?.available === true,
    phoneUse: aiCamera,
    tailgating: aiCamera,
  };
  const counts: Record<string, number | null> = {
    highSpeed: availability.highSpeed ? highSpeed : null,
    rapidAcceleration: availability.rapidAcceleration ? rapidAcceleration : null,
    harshBraking: availability.harshBraking ? harshBraking : null,
    postedSpeed: availability.postedSpeed ? postedSpeed : null,
    phoneUse: availability.phoneUse ? phoneUse : null,
    tailgating: availability.tailgating ? tailgating : null,
  };

  const deductions: Record<string, number> = {};
  let totalDeduction = 0;
  for (const [key, rule] of Object.entries(ALERT_DEDUCTION_RULES)) {
    const deduction = availability[key]
      ? Math.min(rule.dailyCap, (counts[key] || 0) * rule.perEvent)
      : 0;
    deductions[key] = deduction;
    totalDeduction += deduction;
  }

  return {
    score: Math.max(0, 100 - totalDeduction),
    counts,
    availability,
    deductions,
  };
}

function computeIdleScore(driveMinutes: number, idleMinutes: number): {
  score: number | null;
  percentage: number | null;
} {
  const totalEngineActivityMinutes = driveMinutes + idleMinutes;
  if (totalEngineActivityMinutes <= 0) {
    return { score: null, percentage: null };
  }

  const percentage = (idleMinutes / totalEngineActivityMinutes) * 100;
  let score = 0;
  if (percentage <= 7) score = 100;
  else if (percentage <= 10) score = 90;
  else if (percentage <= 15) score = 75;
  else if (percentage <= 20) score = 50;

  return {
    score,
    percentage: Number(percentage.toFixed(1)),
  };
}

function computeOpscenterDrivingScore(metrics: AnyRecord): DriverScoreDetail {
  const milesDriven = Math.max(0, numberFrom(metrics, ["miles_driven", "milesDriven", "miles"]));
  const driveMinutes = Math.max(0, numberFrom(metrics, ["drive_minutes", "driveMinutes", "drive_time_minutes"]));
  const idleMinutes = Math.max(0, numberFrom(metrics, ["idle_minutes", "idleMinutes", "idle_time_minutes"]));
  const speedingEvents = Math.max(0, numberFrom(metrics, ["speeding_events", "speedingEvents"]));
  const severeSpeedingEvents = Math.max(0, numberFrom(metrics, ["severe_speeding_events", "severeSpeedingEvents"]));
  const afterHoursEvents = Math.max(0, numberFrom(metrics, ["after_hours_events", "afterHoursEvents"]));

  const effectiveMiles = Math.max(milesDriven, 25);
  if (milesDriven < 10 && driveMinutes < 30) {
    return {
      score: null,
      display: "Insufficient driving data",
      status: "Insufficient data",
      warning: "Insufficient driving data",
      effectiveMiles: Number(effectiveMiles.toFixed(2)),
      safetyScore: null,
      idleScore: null,
      idlePercentage: null,
      alertCounts: {},
      alertAvailability: {},
      alertDeductions: {},
      speedingPenalty: null,
      severeSpeedingPenalty: null,
      afterHoursPenalty: null,
      source: "OpsCenter calculated",
    };
  }

  const alertSafety = computeWeightedAlertSafetyScore(metrics);
  const speedingRate = effectiveMiles > 0 ? (speedingEvents / effectiveMiles) * 100 : 0;
  const severeSpeedingRate = effectiveMiles > 0 ? (severeSpeedingEvents / effectiveMiles) * 100 : 0;
  const speedingPenalty = Math.min(30, speedingRate * 1.5);
  const severeSpeedingPenalty = Math.min(40, severeSpeedingRate * 3);
  const afterHoursPenalty = Math.min(10, afterHoursEvents * 2);
  const safetyScore = Math.max(0, Math.min(100, alertSafety.score - afterHoursPenalty));
  const idle = computeIdleScore(driveMinutes, idleMinutes);
  const score = Number(Math.max(
    0,
    Math.min(100, idle.score == null ? safetyScore : safetyScore * 0.9 + idle.score * 0.1)
  ).toFixed(1));
  const warning = milesDriven >= 10 && driveMinutes <= 0
    ? "Drive-time data unavailable; score based on mileage and events only."
    : "";

  return {
    score,
    display: score.toFixed(1),
    status: warning ? "Partial" : "Confirmed",
    warning,
    effectiveMiles: Number(effectiveMiles.toFixed(2)),
    safetyScore: Number(safetyScore.toFixed(1)),
    idleScore: idle.score,
    idlePercentage: idle.percentage,
    alertCounts: alertSafety.counts,
    alertAvailability: alertSafety.availability,
    alertDeductions: alertSafety.deductions,
    speedingPenalty: Number(speedingPenalty.toFixed(1)),
    severeSpeedingPenalty: Number(severeSpeedingPenalty.toFixed(1)),
    afterHoursPenalty: Number(afterHoursPenalty.toFixed(1)),
    source: "OpsCenter calculated",
  };
}

function normalizeTruckLabel(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/(\d+)/);
  return match ? `Truck# ${match[1]}` : raw;
}

function isPhysicalTruck(value: unknown): boolean {
  return /^Truck#\s*\d+$/i.test(normalizeTruckLabel(value));
}

function normalizeEmployeeName(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const comma = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (comma.length === 2) return `${comma[1]} ${comma[0]}`;
  return raw;
}

type DriverAssignmentOverride = {
  drivers?: string[];
  excluded_appointment_ids?: string[];
  note?: string;
};

function applyDriverAssignmentOverrides(
  date: string,
  truckRows: AnyRecord[],
  employeeRows: AnyRecord[],
  appointments: AnyRecord[]
): { truckRows: AnyRecord[]; employeeRows: AnyRecord[] } {
  const allOverrides = readJsonFile<Record<string, Record<string, DriverAssignmentOverride>>>(
    path.join("data", "driver-assignment-overrides.json")
  );
  const dateOverrides: Record<string, DriverAssignmentOverride> = {
    ...(allOverrides?.[date] || {}),
  };
  for (const appointment of appointments) {
    if (!appointment?.driver_assignment_excluded) continue;
    const truck = normalizeTruckLabel(appointment?.assigned_truck || appointment?.truck || appointment?.truck_number);
    const appointmentId = String(appointment?.appt_id || appointment?.appointment_id || "");
    if (!truck || !appointmentId) continue;
    const existing = dateOverrides[truck] || {};
    dateOverrides[truck] = {
      ...existing,
      excluded_appointment_ids: Array.from(new Set([
        ...(existing.excluded_appointment_ids || []),
        appointmentId,
      ])),
      note: existing.note || String(appointment?.driver_assignment_exclusion_reason || "Standing driver attribution rule"),
    };
  }
  if (Object.keys(dateOverrides).length === 0) return { truckRows, employeeRows };

  const normalizedOverrides = new Map(
    Object.entries(dateOverrides).map(([truck, override]) => [normalizeTruckLabel(truck), override])
  );
  const allowedDriversByTruck = new Map<string, Set<string>>();
  for (const [truck, override] of normalizedOverrides) {
    if (override.drivers) {
      allowedDriversByTruck.set(
        truck,
        new Set(override.drivers.map(normalizeEmployeeName).filter(Boolean))
      );
    }
  }

  const correctedTruckRows = truckRows.map((row) => {
    const truck = normalizeTruckLabel(row.truck);
    const override = normalizedOverrides.get(truck);
    if (!override) return row;
    const excludedAppointments = new Set((override.excluded_appointment_ids || []).map(String));
    const assignmentWindows = (Array.isArray(row.assignment_windows) ? row.assignment_windows : [])
      .filter((window) => !excludedAppointments.has(String(window?.appointment_id || "")));
    const explicitlyAllowedDrivers = allowedDriversByTruck.get(truck);
    const drivers = explicitlyAllowedDrivers
      ? Array.from(explicitlyAllowedDrivers)
      : Array.from(new Set(assignmentWindows.map((window) => normalizeEmployeeName(window?.driver)).filter(Boolean)));
    return {
      ...row,
      assigned_driver: drivers.length === 1 ? drivers[0] : drivers.length > 1 ? "Multiple" : "",
      assigned_drivers: drivers,
      assignment_windows: assignmentWindows,
      assignment_override: true,
      assignment_override_note: override.note || "Manual driver assignment correction",
      confidence_status: drivers.length > 0 ? "Manual assignment" : row.confidence_status,
      data_quality_notes: [override.note || "Manual driver assignment correction"],
    };
  });

  const correctedEmployeeRows: AnyRecord[] = [];
  for (const row of employeeRows) {
    const employee = normalizeEmployeeName(row.employee_name || row.employee || row.name);
    const assignmentWindows = (Array.isArray(row.assignment_windows) ? row.assignment_windows : []).filter((window) => {
      const truck = normalizeTruckLabel(window?.truck);
      const excludedAppointments = new Set(
        (normalizedOverrides.get(truck)?.excluded_appointment_ids || []).map(String)
      );
      return !excludedAppointments.has(String(window?.appointment_id || ""));
    });
    const originalTrucks = (Array.isArray(row.trucks_driven) ? row.trucks_driven : [row.truck])
      .map(normalizeTruckLabel)
      .filter(Boolean);
    const trucks = originalTrucks.filter((truck) => {
      const allowedDrivers = allowedDriversByTruck.get(truck);
      if (allowedDrivers && !allowedDrivers.has(employee)) return false;
      const override = normalizedOverrides.get(truck);
      if (!override?.excluded_appointment_ids?.length) return true;
      const originalTruckWindows = (Array.isArray(row.assignment_windows) ? row.assignment_windows : [])
        .filter((window) => normalizeTruckLabel(window?.truck) === truck);
      const remainingTruckWindows = assignmentWindows
        .filter((window) => normalizeTruckLabel(window?.truck) === truck);
      return originalTruckWindows.length === 0 || remainingTruckWindows.length > 0;
    });
    if (originalTrucks.length > 0 && trucks.length === 0) continue;
    correctedEmployeeRows.push({ ...row, trucks_driven: trucks, assignment_windows: assignmentWindows });
  }

  const existingEmployees = new Set(
    correctedEmployeeRows.map((row) => normalizeEmployeeName(row.employee_name || row.employee || row.name))
  );
  for (const [truck, drivers] of allowedDriversByTruck) {
    for (const employee of drivers) {
      if (existingEmployees.has(employee)) continue;
      correctedEmployeeRows.push({
        date,
        employee_id: employee,
        employee_name: employee,
        trucks_driven: [truck],
        miles_driven: 0,
        drive_time_minutes: 0,
        drive_time: "0:00",
        idle_time_minutes: 0,
        idle_time: "0:00",
        opscenter_driving_score: null,
        driver_score_display: "Insufficient driving data",
        driver_score_status: "Manual assignment",
        driver_score_source: "OpsCenter calculated",
        confidence_status: "Manual assignment",
        data_quality_notes: [normalizedOverrides.get(truck)?.note || "Manual driver assignment correction"],
      });
      existingEmployees.add(employee);
    }
  }

  return { truckRows: correctedTruckRows, employeeRows: correctedEmployeeRows };
}

function sumBy(rows: AnyRecord[], keys: string[]): number {
  return rows.reduce((sum, row) => {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && value !== "") {
        const num = Number(value);
        if (!Number.isNaN(num)) return sum + num;
      }
    }
    return sum;
  }, 0);
}

function sumByNullable(rows: AnyRecord[], keys: string[]): number | null {
  let total = 0;
  let found = false;

  for (const row of rows) {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && value !== "") {
        const num = Number(value);
        if (!Number.isNaN(num)) {
          total += num;
          found = true;
          break;
        }
      }
    }
  }

  return found ? total : null;
}

function hasOperationalActivity(row: AnyRecord): boolean {
  return [
    "crew_hours",
    "revenue",
    "jobs",
    "miles_driven",
    "drive_minutes",
    "idle_minutes",
    "truck_driving_score",
    "driver_score",
  ].some((key) => Number(row?.[key] || 0) > 0);
}

function getInputPath(metrics: AnyRecord, key: string): string | null {
  const rel = metrics?.inputs?.[key];
  if (typeof rel !== "string" || !rel.trim()) return null;
  return resolveHistoryPath(rel) ? rel : null;
}

function readAppointmentVisits(date: string): AnyRecord[] {
  const rel = path.join("data", "history", "linxup", "appointment_visits", `linxup_appointment_visits_${date}.json`);
  const payload = readJsonFile<AnyRecord>(rel);
  const visits = Array.isArray(payload?.visits) ? payload.visits : [];
  return visits as AnyRecord[];
}

function readLinxupTripMileageByTruck(date: string): Map<string, number> {
  const rel = path.join("data", "history", "linxup", `linxup_location_${date}.json`);
  const payload = readJsonFile<AnyRecord>(rel);
  const trips = Array.isArray(payload?.trips) ? payload.trips : [];
  const mileage = new Map<string, number>();

  for (const trip of trips) {
    const truck = normalizeTruckLabel(
      trip?.truck_number || trip?.personName || trip?.driverName || trip?.truck
    );
    if (!truck) continue;
    const standardMiles = Number(trip?.distanceMiles);
    const detailedMiles = Number(trip?.distanceMilesDetailed);
    const miles = Number.isFinite(standardMiles) && standardMiles >= 0
      ? standardMiles
      : Number.isFinite(detailedMiles) && detailedMiles >= 0
        ? detailedMiles
        : 0;
    mileage.set(truck, (mileage.get(truck) || 0) + miles);
  }

  return mileage;
}

function buildSourceFlags(metrics: AnyRecord, visits: AnyRecord[], revenue: number, completedJobs: number): FleetSourceFlags {
  const truckRows = Array.isArray(metrics?.truck_performance) ? metrics.truck_performance : [];
  const truckDriverRows = Array.isArray(metrics?.truck_driver_scores) ? metrics.truck_driver_scores : [];
  const employeeDriverRows = Array.isArray(metrics?.employee_driver_scores) ? metrics.employee_driver_scores : [];

  return {
    appointments: Boolean(getInputPath(metrics, "junkware_raw")) || Array.isArray(metrics?.appointments),
    completedJobs: Boolean(getInputPath(metrics, "junkware_completed_summary") || getInputPath(metrics, "junkware_summary")),
    revenue: Boolean(getInputPath(metrics, "junkware_truck_records")) || metrics?.total_revenue != null || revenue > 0,
    crewAssignments: Boolean(getInputPath(metrics, "junkware_employee_summary")),
    driverAssignments: truckDriverRows.length > 0 || employeeDriverRows.length > 0,
    linxupTrips: Boolean(getInputPath(metrics, "linxup_raw")) || truckDriverRows.length > 0,
    linxupMileage: truckDriverRows.some((row) => Number(row?.miles_driven || 0) > 0),
    linxupAlerts: truckDriverRows.some((row) =>
      row?.alert_collection_status === "passed" ||
      Number(row?.alert_event_count || 0) > 0 ||
      row?.hard_braking_events != null ||
      row?.seat_belt_events != null ||
      row?.idle_started_events != null ||
      row?.idle_ended_events != null ||
      row?.ignition_started_events != null ||
      row?.ignition_stopped_events != null ||
      row?.geofence_entered_events != null ||
      row?.geofence_exited_events != null ||
      row?.video_alert_count != null ||
      Number(row?.speeding_events || 0) > 0 ||
      Number(row?.severe_speeding_events || 0) > 0 ||
      Number(row?.after_hours_events || 0) > 0
    ),
    driverScores: employeeDriverRows.length > 0,
    maintenanceData: Boolean(metrics?.trucks_due_for_service) || Boolean(metrics?.maintenance_data),
  };
}

function gpsStatusForRow(sourceFlags: FleetSourceFlags, truckRows: AnyRecord[], truckDriverRows: AnyRecord[], visits: AnyRecord[]): string {
  const hasCoverage = truckDriverRows.some((row) => Number(row?.miles_driven || 0) > 0 || Number(row?.drive_minutes || 0) > 0 || Number(row?.idle_minutes || 0) > 0) || visits.length > 0;
  if (!hasCoverage) return "GPS unavailable";
  return truckRows.some((row) => row?.confidence_status && String(row.confidence_status).toLowerCase() !== "confirmed")
    ? "Partial GPS"
    : "Partial GPS";
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number | null {
  const totalWeight = values.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (totalWeight <= 0) return null;
  const weighted = values.reduce((sum, item) => sum + item.value * Math.max(0, item.weight), 0);
  return weighted / totalWeight;
}

export function getMonthDates(selectedDate: string): string[] {
  const prefix = String(selectedDate || "").slice(0, 7);
  return availableDates().filter((date) => date.startsWith(prefix)).sort();
}

export function getJulyDates(): string[] {
  return getMonthDates("2026-07-01");
}

export function buildFleetDailyRecord(date: string): FleetDailyRecord | null {
  const metrics = readMetrics(date);
  if (!metrics) return null;

  const appointments = Array.isArray(metrics.appointments) ? metrics.appointments : [];
  const truckRows = Array.isArray(metrics.truck_performance) ? metrics.truck_performance : [];
  const tripMileageByTruck = readLinxupTripMileageByTruck(date);
  const rawTruckDriverRows = (Array.isArray(metrics.truck_driver_scores) ? metrics.truck_driver_scores : []).map((row) => {
    const truck = normalizeTruckLabel(row?.truck);
    const correctedMiles = tripMileageByTruck.get(truck);
    return correctedMiles == null ? row : { ...row, miles_driven: Number(correctedMiles.toFixed(2)) };
  });
  const soleDriverByTruck = new Map<string, string>();
  for (const row of rawTruckDriverRows) {
    const uniqueDrivers = Array.from(new Set<string>(
      (Array.isArray(row?.assigned_drivers) ? row.assigned_drivers : [])
        .map(normalizeEmployeeName)
        .filter(Boolean)
    ));
    if (uniqueDrivers.length === 1) soleDriverByTruck.set(normalizeTruckLabel(row?.truck), uniqueDrivers[0]);
  }
  const scoredTruckDriverRows = rawTruckDriverRows.map((row) => {
    const score = computeOpscenterDrivingScore({ ...row, date });
    return {
      ...row,
      opscenter_driving_score: score.score,
      driver_score_display: score.display,
      driver_score_status: row.driver_score_status || row.confidence_status || score.status,
      driver_score_source: score.source,
      safety_score: score.safetyScore,
      idle_score: score.idleScore,
      idle_percentage: score.idlePercentage,
      weighted_alert_counts: score.alertCounts,
      weighted_alert_availability: score.alertAvailability,
      alert_deductions: score.alertDeductions,
    };
  });
  const scoredEmployeeDriverRows = (Array.isArray(metrics.employee_driver_scores) ? metrics.employee_driver_scores : []).map((row) => {
    const employee = normalizeEmployeeName(row?.employee_name || row?.employee || row?.name);
    const trucks = (Array.isArray(row?.trucks_driven) ? row.trucks_driven : [row?.truck])
      .map(normalizeTruckLabel)
      .filter(Boolean);
    const correctedMiles = trucks.length === 1 && soleDriverByTruck.get(trucks[0]) === employee
      ? tripMileageByTruck.get(trucks[0])
      : null;
    const correctedRow = correctedMiles == null
      ? row
      : { ...row, miles_driven: Number(correctedMiles.toFixed(2)) };
    const score = computeOpscenterDrivingScore({ ...correctedRow, date });
    return {
      ...correctedRow,
      opscenter_driving_score: score.score,
      driver_score_display: score.display,
      driver_score_status: row.driver_score_status || row.confidence_status || score.status,
      driver_score_source: score.source,
      safety_score: score.safetyScore,
      idle_score: score.idleScore,
      idle_percentage: score.idlePercentage,
      weighted_alert_counts: score.alertCounts,
      weighted_alert_availability: score.alertAvailability,
      alert_deductions: score.alertDeductions,
    };
  });
  const correctedAssignments = applyDriverAssignmentOverrides(
    date,
    scoredTruckDriverRows,
    scoredEmployeeDriverRows,
    appointments
  );
  const truckDriverRows = correctedAssignments.truckRows;
  const navigatorsByTruck = new Map<string, Set<string>>();
  for (const appointment of appointments) {
    const truck = normalizeTruckLabel(appointment?.assigned_truck || appointment?.truck || appointment?.truck_number);
    const navigator = normalizeEmployeeName(
      appointment?.navigator_normalized_name || appointment?.navigator_name || appointment?.navigator
    );
    if (!truck || !navigator || appointment?.driver_assignment_excluded) continue;
    const names = navigatorsByTruck.get(truck) || new Set<string>();
    names.add(navigator);
    navigatorsByTruck.set(truck, names);
  }

  const employeeDriverRows: AnyRecord[] = correctedAssignments.employeeRows.map((row): AnyRecord => {
    const trucks = (Array.isArray(row?.trucks_driven) ? row.trucks_driven : [row?.truck])
      .map(normalizeTruckLabel)
      .filter(Boolean);
    const navigatorNames = Array.from(new Set(trucks.flatMap((truck) => Array.from(navigatorsByTruck.get(truck) || []))));
    return { ...row, score_role: "Driver", navigator_names: navigatorNames };
  });

  const navigatorScoreRows: AnyRecord[] = [];
  for (const [truck, navigatorNames] of navigatorsByTruck) {
    const truckScore = truckDriverRows.find((row) => normalizeTruckLabel(row?.truck) === truck);
    if (!truckScore) continue;
    const attributedDriverScore = employeeDriverRows.find((row) => {
      const trucks = (Array.isArray(row?.trucks_driven) ? row.trucks_driven : [row?.truck])
        .map(normalizeTruckLabel);
      const score = row?.opscenter_driving_score;
      return trucks.includes(truck) && score !== null && score !== undefined && score !== "" && Number.isFinite(Number(score));
    });
    const sharedScore = attributedDriverScore || truckScore;
    for (const navigator of navigatorNames) {
      navigatorScoreRows.push({
        ...sharedScore,
        employee_id: navigator,
        employee_name: navigator,
        trucks_driven: [truck],
        score_role: "Navigator",
        score_inherited_from_driver: true,
        driver_score_status: "Shared truck score",
        driver_score_source: "OpsCenter calculated",
      });
    }
  }
  const visits = readAppointmentVisits(date);

  const revenue = Number(metrics.total_revenue ?? metrics.sales ?? 0) || 0;
  const jobsCompleted = metrics.jobs_by_truck
    ? Object.values(metrics.jobs_by_truck).reduce<number>((sum, value) => sum + Number(value || 0), 0)
    : 0;
  const completedJobs = Number(metrics.completed_jobs ?? metrics.jobs_completed ?? jobsCompleted ?? 0) || 0;
  const estimates = appointments.filter((row) => String(row?.appointment_type || row?.type || "").toLowerCase().includes("estimate")).length;

  const activeRows = truckRows.filter((row) => isPhysicalTruck(row?.truck) && hasOperationalActivity(row));
  const activeTruckList = Array.from(
    new Set([
      ...activeRows.map((row) => normalizeTruckLabel(row.truck)).filter(Boolean),
      ...truckDriverRows
        .filter((row) =>
          isPhysicalTruck(row?.truck) &&
          (Number(row?.miles_driven || 0) > 0 ||
            Number(row?.drive_minutes || 0) > 0 ||
            Number(row?.idle_minutes || 0) > 0)
        )
        .map((row) => normalizeTruckLabel(row.truck))
        .filter(Boolean),
    ])
  );
  const usedTruckList = Array.from(new Set([
    ...activeTruckList,
    ...truckRows.filter((row) => isPhysicalTruck(row?.truck)).map((row) => normalizeTruckLabel(row.truck)).filter(Boolean),
    ...truckDriverRows.filter((row) => isPhysicalTruck(row?.truck)).map((row) => normalizeTruckLabel(row.truck)).filter(Boolean),
    ...appointments
      .filter((row) => isPhysicalTruck(row?.truck || row?.assigned_truck))
      .map((row) => normalizeTruckLabel(row.truck || row.assigned_truck))
      .filter(Boolean),
  ]));

  const sourceFlags = buildSourceFlags(metrics, visits, revenue, completedJobs);
  const gpsCoverage = truckDriverRows.length > 0 || visits.length > 0;
  const mileageCoverage = gpsCoverage && truckDriverRows.some((row) => Number(row?.miles_driven || 0) > 0);
  const alertCoverage = gpsCoverage && truckDriverRows.some((row) =>
    Number(row?.speeding_events || 0) > 0 ||
    Number(row?.severe_speeding_events || 0) > 0 ||
    Number(row?.after_hours_events || 0) > 0
  );

  const totalMiles = mileageCoverage ? sumBy(truckDriverRows, ["miles_driven"]) : null;
  const averageMilesPerActiveTruck = totalMiles != null && activeTruckList.length > 0 ? totalMiles / activeTruckList.length : null;
  const driveTimeMinutes = gpsCoverage ? sumBy(truckDriverRows, ["drive_minutes"]) : null;
  const idleTimeMinutes = gpsCoverage ? sumBy(truckDriverRows, ["idle_minutes"]) : null;
  const totalSiteTimeMinutes = visits.length > 0 ? sumBy(visits, ["onsite_minutes"]) : null;
  const averageSiteTimePerJob = totalSiteTimeMinutes != null && completedJobs > 0 ? totalSiteTimeMinutes / completedJobs : null;
  const driverScoreValues = employeeDriverRows
    .map((row) => Number(row?.opscenter_driving_score ?? row?.driver_score ?? row?.driverScore ?? NaN))
    .filter((value) => !Number.isNaN(value));
  const driversScored = gpsCoverage ? driverScoreValues.length : null;
  const averageDriverScore = gpsCoverage && driverScoreValues.length > 0
    ? driverScoreValues.reduce((sum, value) => sum + value, 0) / driverScoreValues.length
    : null;
  const speedingEvents = gpsCoverage ? sumBy(truckDriverRows, ["speeding_events"]) : null;
  const severeSpeedingEvents = gpsCoverage ? sumBy(truckDriverRows, ["severe_speeding_events"]) : null;
  const hardBrakingEvents = gpsCoverage ? sumByNullable(truckDriverRows, ["hard_braking_events", "hardBrakingEvents"]) : null;
  const afterHoursEvents = gpsCoverage ? sumBy(truckDriverRows, ["after_hours_events"]) : null;
  const trucksWithWarnings = gpsCoverage
    ? truckDriverRows.filter((row) =>
        String(row?.confidence_status || "").toLowerCase() !== "confirmed" ||
        Array.isArray(row?.data_quality_notes) && row.data_quality_notes.length > 0
      ).length
    : null;
  const trucksDueForService = metrics?.trucks_due_for_service != null ? Number(metrics.trucks_due_for_service) : null;

  const gpsDataStatus = gpsCoverage ? "Partial GPS" : "GPS unavailable";
  const sourceNotes = Array.isArray(metrics?.inputs?.missing) ? metrics.inputs.missing : [];

  return {
    date,
    revenue,
    activeTrucks: activeTruckList.length,
    trucksUsed: usedTruckList.length,
    jobsCompleted: completedJobs,
    estimates,
    totalMiles,
    averageMilesPerActiveTruck,
    driveTimeMinutes,
    idleTimeMinutes,
    totalSiteTimeMinutes,
    averageSiteTimePerJob,
    driversScored,
    averageDriverScore,
    speedingEvents,
    severeSpeedingEvents,
    hardBrakingEvents,
    afterHoursEvents,
    trucksDueForService,
    trucksWithWarnings,
    gpsDataStatus,
    gpsCoverage,
    mileageCoverage,
    alertCoverage,
    sourceFlags,
    sourceNotes,
    trucksUsedList: usedTruckList,
    activeTruckList,
    visits,
    truckRows,
    truckScoreRows: truckDriverRows,
    employeeScoreRows: employeeDriverRows,
    navigatorScoreRows,
    appointments,
  };
}

function formatDriverScore(value: number | null): number | null {
  return value == null || Number.isNaN(value) ? null : Number(value.toFixed(1));
}

function formatMinutesValue(value: number | null): number | null {
  return value == null || Number.isNaN(value) ? null : Number(value.toFixed(2));
}

export function buildFleetMonthlySummary(selectedDate: string, params: SummaryParams = {}): JulyFleetSummary {
  const dates = getMonthDates(selectedDate)
    .map((date) => buildFleetDailyRecord(date))
    .filter((row): row is FleetDailyRecord => Boolean(row));

  const coveredDates = dates.filter((row) => row.gpsCoverage);
  const totalRevenue = dates.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const totalCompletedJobs = dates.reduce((sum, row) => sum + Number(row.jobsCompleted || 0), 0);
  const uniqueTrucksUsed = new Set(dates.flatMap((row) => row.trucksUsedList)).size;
  const totalMilesRecorded = coveredDates.length > 0
    ? coveredDates.reduce((sum, row) => sum + Number(row.totalMiles || 0), 0)
    : null;
  const averageDailyActiveTrucks = dates.length > 0
    ? dates.reduce((sum, row) => sum + Number(row.activeTrucks || 0), 0) / dates.length
    : null;
  const totalDriveTimeMinutes = coveredDates.length > 0
    ? coveredDates.reduce((sum, row) => sum + Number(row.driveTimeMinutes || 0), 0)
    : null;
  const totalIdleTimeMinutes = coveredDates.length > 0
    ? coveredDates.reduce((sum, row) => sum + Number(row.idleTimeMinutes || 0), 0)
    : null;
  const totalSpeedingEvents = coveredDates.length > 0
    ? coveredDates.reduce((sum, row) => sum + Number(row.speedingEvents || 0), 0)
    : null;
  const totalSevereSpeedingEvents = coveredDates.length > 0
    ? coveredDates.reduce((sum, row) => sum + Number(row.severeSpeedingEvents || 0), 0)
    : null;
  const totalHardBrakingEvents = coveredDates.some((row) => row.hardBrakingEvents != null)
    ? coveredDates.reduce((sum, row) => sum + Number(row.hardBrakingEvents || 0), 0)
    : null;
  const totalAfterHoursEvents = coveredDates.length > 0
    ? coveredDates.reduce((sum, row) => sum + Number(row.afterHoursEvents || 0), 0)
    : null;
  const trucksCurrentlyDueForService = dates.some((row) => row.trucksDueForService != null)
    ? dates.reduce((sum, row) => sum + Number(row.trucksDueForService || 0), 0)
    : null;

  const driverMap = new Map<string, DriverHistoryRow>();
  const truckMap = new Map<string, TruckHistoryRow>();

  for (const row of dates) {
    for (const driverRow of row.employeeScoreRows) {
      const name = normalizeEmployeeName(driverRow.employee_name || driverRow.employee || driverRow.name);
      if (!name) continue;
      const score = Number(driverRow.opscenter_driving_score ?? driverRow.driver_score ?? driverRow.driverScore ?? NaN);
      const driverKey = name.toLowerCase();
      const existing: DriverHistoryRow = driverMap.get(driverKey) || {
        name,
        daysAssigned: 0,
        trucks: [],
        milesDriven: 0,
        driveTimeMinutes: 0,
        idleTimeMinutes: 0,
        averageDriverScore: null,
        driverScoreDisplay: "Insufficient driving data",
        driverScoreStatus: "Insufficient data",
        driverScoreWarning: "Insufficient driving data",
        driverScoreSource: "OpsCenter calculated",
        bestScore: null,
        lowestScore: null,
        speedingEvents: 0,
        severeSpeedingEvents: 0,
        hardBrakingEvents: null,
        afterHoursEvents: 0,
        confirmedDays: 0,
        partialOrAmbiguousDays: 0,
        eligibleDays: 0,
        ineligibleDays: 0,
        days: [] as AnyRecord[],
      };
      existing.daysAssigned += 1;
      const trucks = Array.isArray(driverRow.trucks_driven) ? driverRow.trucks_driven : [];
      for (const truck of trucks) {
        if (truck && !existing.trucks.includes(truck)) existing.trucks.push(truck);
      }
      existing.milesDriven += Number(driverRow.miles_driven || 0);
      existing.driveTimeMinutes += Number(driverRow.drive_time_minutes || 0);
      existing.idleTimeMinutes += Number(driverRow.idle_time_minutes || 0);
      if (!Number.isNaN(score)) {
        existing.averageDriverScore = existing.averageDriverScore == null
          ? score
          : (existing.averageDriverScore * (existing.days.length) + score) / (existing.days.length + 1);
        existing.bestScore = existing.bestScore == null ? score : Math.max(existing.bestScore, score);
        existing.lowestScore = existing.lowestScore == null ? score : Math.min(existing.lowestScore, score);
        existing.eligibleDays += 1;
      } else {
        existing.ineligibleDays += 1;
      }
      existing.speedingEvents += Number(driverRow.speeding_events || 0);
      existing.severeSpeedingEvents += Number(driverRow.severe_speeding_events || 0);
      const driverHardBraking = driverRow.hard_braking_events;
      if (driverHardBraking !== undefined && driverHardBraking !== null && driverHardBraking !== "") {
        existing.hardBrakingEvents = (existing.hardBrakingEvents ?? 0) + Number(driverHardBraking || 0);
      }
      existing.afterHoursEvents += Number(driverRow.after_hours_events || 0);
      if (String(driverRow.confidence_status || "").toLowerCase() === "confirmed") existing.confirmedDays += 1;
      if (["partial", "ambiguous"].includes(String(driverRow.confidence_status || "").toLowerCase())) existing.partialOrAmbiguousDays += 1;
      existing.days.push({
        date: row.date,
        truck: trucks.join(", ") || "Unassigned",
        miles: Number(driverRow.miles_driven || 0),
        driveTime: driverRow.drive_time || "—",
        idleTime: driverRow.idle_time || "—",
        hardBrakingEvents: driverRow.hard_braking_events ?? null,
        score: Number.isNaN(score) ? null : score,
        status: driverRow.confidence_status || "—",
        notes: Array.isArray(driverRow.data_quality_notes) ? driverRow.data_quality_notes : [],
      });
      driverMap.set(driverKey, existing);
    }

    for (const truckRow of row.truckScoreRows) {
      const truck = normalizeTruckLabel(truckRow.truck);
      if (!truck) continue;
      const existing: TruckHistoryRow = truckMap.get(truck.toLowerCase()) || {
        truck,
        daysUsed: 0,
        jobsCompleted: 0,
        revenue: 0,
        miles: 0,
        driveTimeMinutes: 0,
        idleTimeMinutes: 0,
        siteTimeMinutes: 0,
        drivers: [],
        averageDriverScore: null,
        driverScoreDisplay: "Insufficient driving data",
        driverScoreStatus: "Insufficient data",
        driverScoreWarning: "Insufficient driving data",
        driverScoreSource: "OpsCenter calculated",
        speedingEvents: 0,
        severeSpeedingEvents: 0,
        hardBrakingEvents: null,
        afterHoursEvents: 0,
        safetyEvents: 0,
        currentOdometer: "—",
        serviceStatus: "Unavailable",
        lastGpsDate: row.date,
        days: [] as AnyRecord[],
      };
      existing.daysUsed += 1;
      existing.jobsCompleted += Number((row.truckRows.find((truckRow) => normalizeTruckLabel(truckRow.truck) === truck)?.jobs) || 0);
      existing.revenue += Number((row.truckRows.find((truckRow) => normalizeTruckLabel(truckRow.truck) === truck)?.revenue) || 0);
      existing.miles += Number(truckRow.miles_driven || 0);
      existing.driveTimeMinutes += Number(truckRow.drive_minutes || 0);
      existing.idleTimeMinutes += Number(truckRow.idle_minutes || 0);
      const visitForTruck = row.visits.filter((visit) => normalizeTruckLabel(visit.truck_number || visit.truck || visit.truckNumber) === truck);
      existing.siteTimeMinutes += visitForTruck.reduce((sum, visit) => sum + Number(visit.onsite_minutes || 0), 0);
      const seedAssignedDrivers = Array.isArray(truckRow.assigned_drivers) ? truckRow.assigned_drivers : [];
      for (const driver of seedAssignedDrivers) {
        if (driver && !existing.drivers.includes(driver)) existing.drivers.push(driver);
      }
      const truckScore = Number(truckRow.opscenter_driving_score ?? truckRow.driver_score ?? NaN);
      if (!Number.isNaN(truckScore)) {
        existing.averageDriverScore = existing.averageDriverScore == null
          ? truckScore
          : (existing.averageDriverScore * (existing.days.length) + truckScore) / (existing.days.length + 1);
      }
      existing.speedingEvents += Number(truckRow.speeding_events || 0);
      existing.severeSpeedingEvents += Number(truckRow.severe_speeding_events || 0);
      const truckHardBraking = truckRow.hard_braking_events;
      if (truckHardBraking !== undefined && truckHardBraking !== null && truckHardBraking !== "") {
        existing.hardBrakingEvents = (existing.hardBrakingEvents ?? 0) + Number(truckHardBraking || 0);
      }
      existing.afterHoursEvents += Number(truckRow.after_hours_events || 0);
      existing.safetyEvents += Number(truckRow.speeding_events || 0) + Number(truckRow.severe_speeding_events || 0) + Number(truckRow.after_hours_events || 0);
      existing.lastGpsDate = row.date;
      existing.days.push({
        date: row.date,
        driver: truckRow.assigned_driver || "Unassigned",
        miles: Number(truckRow.miles_driven || 0),
        driveTime: truckRow.drive_minutes || 0,
        idleTime: truckRow.idle_minutes || 0,
        hardBrakingEvents: truckRow.hard_braking_events ?? null,
        score: Number.isNaN(truckScore) ? null : truckScore,
        status: truckRow.confidence_status || "—",
        notes: Array.isArray(truckRow.data_quality_notes) ? truckRow.data_quality_notes : [],
      });
      truckMap.set(truck.toLowerCase(), existing);

      const assignedDrivers = Array.isArray(truckRow.assigned_drivers) ? truckRow.assigned_drivers : [];
      for (const driver of assignedDrivers) {
        const driverName = normalizeEmployeeName(driver);
        if (!driverName) continue;
        const driverKey = driverName.toLowerCase();
        const driverExisting: DriverHistoryRow = driverMap.get(driverKey) || {
          name: driverName,
          daysAssigned: 0,
          trucks: [],
          milesDriven: 0,
          driveTimeMinutes: 0,
          idleTimeMinutes: 0,
          averageDriverScore: null,
          driverScoreDisplay: "Insufficient driving data",
          driverScoreStatus: "Insufficient data",
          driverScoreWarning: "Insufficient driving data",
          driverScoreSource: "OpsCenter calculated",
          bestScore: null,
          lowestScore: null,
          speedingEvents: 0,
          severeSpeedingEvents: 0,
          hardBrakingEvents: null,
          afterHoursEvents: 0,
          confirmedDays: 0,
          partialOrAmbiguousDays: 0,
          eligibleDays: 0,
          ineligibleDays: 0,
          days: [] as AnyRecord[],
        };
        if (driverExisting.days.some((day) => day.date === row.date)) continue;
        driverExisting.daysAssigned += 1;
        if (!driverExisting.trucks.includes(truck)) driverExisting.trucks.push(truck);
        driverExisting.days.push({
          date: row.date,
          truck,
          miles: 0,
          driveTime: "0:00",
          idleTime: "0:00",
          hardBrakingEvents: null,
          score: null,
          status: truckRow.confidence_status || "Insufficient data",
          notes: Array.isArray(truckRow.data_quality_notes) && truckRow.data_quality_notes.length
            ? truckRow.data_quality_notes
            : ["Insufficient driving data"],
        });
        driverExisting.ineligibleDays += 1;
        driverMap.set(driverKey, driverExisting);
      }
    }
  }

  const sortKey = params.sortKey || "date";
  const sortDirection = params.sortDirection || "asc";

  const sortValue = (row: FleetDailyRecord) => {
    switch (sortKey) {
      case "revenue": return row.revenue ?? -Infinity;
      case "jobs": return row.jobsCompleted ?? -Infinity;
      case "miles": return row.totalMiles ?? -Infinity;
      case "driverScore": return row.averageDriverScore ?? -Infinity;
      case "date":
      default:
        return row.date;
    }
  };

  const direction = sortDirection === "desc" ? -1 : 1;
  const sortedDates = [...dates].sort((a, b) => {
    const aVal = sortValue(a);
    const bVal = sortValue(b);
    if (typeof aVal === "string" && typeof bVal === "string") {
      return aVal.localeCompare(bVal) * direction;
    }
    return ((Number(aVal) || 0) - (Number(bVal) || 0)) * direction;
  });

  const driverRows = Array.from(driverMap.values())
    .map((row) => {
      const eligibleDays = row.days.filter((day) => day.score != null).length;
      const ineligibleDays = row.days.filter((day) => day.score == null).length;
      const scoreDetail = computeOpscenterDrivingScore({
        miles_driven: row.milesDriven,
        drive_minutes: row.driveTimeMinutes,
        idle_minutes: row.idleTimeMinutes,
        speeding_events: row.speedingEvents,
        severe_speeding_events: row.severeSpeedingEvents,
        after_hours_events: row.afterHoursEvents,
      });
      return {
        ...row,
        averageDriverScore: scoreDetail.score,
        driverScoreDisplay: scoreDetail.display,
        driverScoreStatus: scoreDetail.status,
        driverScoreWarning: scoreDetail.warning,
        driverScoreSource: scoreDetail.source,
        eligibleDays,
        ineligibleDays,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const truckRows = Array.from(truckMap.values())
    .map((row) => {
      const scoreDetail = computeOpscenterDrivingScore({
        miles_driven: row.miles,
        drive_minutes: row.driveTimeMinutes,
        idle_minutes: row.idleTimeMinutes,
        speeding_events: row.speedingEvents,
        severe_speeding_events: row.severeSpeedingEvents,
        after_hours_events: row.afterHoursEvents,
      });
      return {
        ...row,
        averageDriverScore: scoreDetail.score,
        driverScoreDisplay: scoreDetail.display,
        driverScoreStatus: scoreDetail.status,
        driverScoreWarning: scoreDetail.warning,
        driverScoreSource: scoreDetail.source,
      };
    })
    .sort((a, b) => a.truck.localeCompare(b.truck));

  const summaryDriverScores = driverRows
    .map((row) => row.averageDriverScore)
    .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
  const summaryAverageDriverScore = summaryDriverScores.length > 0
    ? summaryDriverScores.reduce((sum, value) => sum + value, 0) / summaryDriverScores.length
    : null;

  return {
    dates: sortedDates,
    coverageDays: coveredDates.length,
    totalRevenue,
    totalCompletedJobs,
    uniqueTrucksUsed,
    totalMilesRecorded: formatMinutesValue(totalMilesRecorded),
    averageDailyActiveTrucks: averageDailyActiveTrucks == null ? null : Number(averageDailyActiveTrucks.toFixed(2)),
    totalDriveTimeMinutes: formatMinutesValue(totalDriveTimeMinutes),
    totalIdleTimeMinutes: formatMinutesValue(totalIdleTimeMinutes),
    averageDriverScore: formatDriverScore(summaryAverageDriverScore),
    totalSpeedingEvents: formatMinutesValue(totalSpeedingEvents),
    totalSevereSpeedingEvents: formatMinutesValue(totalSevereSpeedingEvents),
    totalHardBrakingEvents,
    totalAfterHoursEvents: formatMinutesValue(totalAfterHoursEvents),
    trucksCurrentlyDueForService,
    sortKey,
    sortDirection,
    driverRows,
    truckRows,
    sourceAuditRows: dates,
  };
}

export function buildJulyFleetSummary(params: SummaryParams = {}): JulyFleetSummary {
  return buildFleetMonthlySummary("2026-07-01", params);
}
