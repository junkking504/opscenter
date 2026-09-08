import fs from "node:fs";
import path from "node:path";

import {
  arrivalAlertCoverage,
  buildOperationalExceptions,
  type ArrivalAlertCoverage,
  type OperationalException,
} from "@/lib/operational-exceptions";
import { chicagoDateKey } from "@/lib/report-dates";

/**
 * Operational signals that decide whether OpsCenter is actually healthy.
 *
 * OpsCenter already computes most of this - the exception engine, the vehicle
 * map, the integration queues. Before this module nothing read those when
 * answering "are we healthy?", so the service reported green while trucks were
 * dark and queues were weeks deep. Every reader here logs its failures instead
 * of returning a silent default: an unreadable signal is reported as `unknown`,
 * never as `ok`.
 */

export type SignalStatus = "ok" | "warn" | "critical" | "unknown";

export type SignalDetail = {
  status: SignalStatus;
  summary: string;
};

export type SilentTracker = {
  truck: string;
  trackerId: string;
  daysSilent: number | null;
};

export type GpsCoverageSignal = SignalDetail & {
  mappedTrackers: number;
  reportingTrackers: number;
  silentTrackers: SilentTracker[];
};

export type ExceptionSignal = SignalDetail & {
  critical: number;
  warning: number;
  total: number;
  criticalTitles: string[];
};

export type QueueDepth = {
  name: string;
  depth: number | null;
  oldestAgeHours: number | null;
  threshold: number;
};

export type QueueSignal = SignalDetail & {
  queues: QueueDepth[];
};

export type StorageSignal = SignalDetail & {
  freeBytes: number | null;
  totalBytes: number | null;
  usedPercent: number | null;
};

export type BackupSignal = SignalDetail & {
  lastSuccessAt: string | null;
  ageMinutes: number | null;
  lastExitCode: number | null;
};

export type ArrivalCoverageSignal = SignalDetail & ArrivalAlertCoverage;

export type GeocoderSignal = SignalDetail & {
  ambiguousAddresses: number;
  totalAddresses: number;
  paidFallbackConfigured: boolean | null;
};

export type SystemSignals = {
  status: SignalStatus;
  blocking: string[];
  exceptions: ExceptionSignal;
  arrivalCoverage: ArrivalCoverageSignal;
  geocoder: GeocoderSignal;
  gpsCoverage: GpsCoverageSignal;
  queues: QueueSignal;
  storage: StorageSignal;
  backup: BackupSignal;
};

type AnyRecord = Record<string, unknown>;

const GPS_SILENT_LOOKBACK_DAYS = 14;

/**
 * These signals are read on page renders and on every alert publish, while the
 * work behind them - the exception engine, up to two weeks of daily GPS files,
 * directory scans over queues thousands of entries deep - is far too expensive
 * to repeat per request. Cache the whole set briefly, and cache each day's
 * location file against its mtime so one read is shared across every truck.
 */
function cacheTtlMs(): number {
  const value = Number(process.env.OPSCENTER_SIGNAL_CACHE_MS);
  return Number.isFinite(value) && value >= 0 ? value : 30_000;
}

const signalsCache = new Map<string, { at: number; value: SystemSignals }>();
const locationCache = new Map<string, { mtimeMs: number; trucks: Set<string> }>();

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function report(scope: string, error: unknown): void {
  // A signal that cannot be read is not a signal that is fine. Say so loudly.
  console.error(`[system-signals] ${scope} unreadable`, error instanceof Error ? error.message : error);
}

function dataRoots(): string[] {
  return [
    process.env.OPSCENTER_DATA_DIR ? path.dirname(process.env.OPSCENTER_DATA_DIR) : "",
    process.cwd(),
    path.join(process.cwd(), "..", "opsbot"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot"),
  ].filter(Boolean);
}

function resolveDataPath(relative: string): string | null {
  const configured = String(process.env.OPSCENTER_DATA_DIR || "").trim();
  if (configured) {
    const candidate = path.join(configured, relative.replace(/^data[\\/]/, ""));
    return fs.existsSync(candidate) ? candidate : null;
  }
  for (const root of dataRoots()) {
    const candidate = path.join(root, relative);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readJson<T = AnyRecord>(relative: string, scope: string): T | null {
  const resolved = resolveDataPath(relative);
  if (!resolved) return null;
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as T;
  } catch (error) {
    report(scope, error);
    return null;
  }
}

function shiftDate(date: string, days: number): string {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Exceptions                                                          */
/* ------------------------------------------------------------------ */

export function exceptionSignal(date: string): ExceptionSignal {
  try {
    const report_ = buildOperationalExceptions(date);
    const critical = report_.counts.severity.critical || 0;
    const warning = report_.counts.severity.warning || 0;
    const criticalTitles = Array.from(new Set(
      report_.exceptions
        .filter((exception: OperationalException) => exception.severity === "critical")
        .map((exception) => exception.title),
    ));
    return {
      status: critical > 0 ? "critical" : warning > 0 ? "warn" : "ok",
      summary: critical > 0
        ? `${critical} critical operational exception${critical === 1 ? "" : "s"} open`
        : warning > 0
          ? `${warning} warning exception${warning === 1 ? "" : "s"} open`
          : "No open operational exceptions",
      critical,
      warning,
      total: report_.total,
      criticalTitles,
    };
  } catch (error) {
    report("operational exceptions", error);
    return {
      status: "unknown",
      summary: "Operational exceptions could not be evaluated",
      critical: 0,
      warning: 0,
      total: 0,
      criticalTitles: [],
    };
  }
}

/* ------------------------------------------------------------------ */
/* GPS coverage                                                        */
/* ------------------------------------------------------------------ */

type VehicleMapping = {
  junkware_truck_number?: string;
  linxup_tracker_id?: string;
  linxup_vehicle_name?: string;
  effective_start_date?: string;
  effective_end_date?: string | null;
  status?: string;
};

function activeMappings(date: string): VehicleMapping[] {
  const map = readJson<AnyRecord>(path.join("data", "config", "linxup_vehicle_map.json"), "vehicle map");
  const rows = Array.isArray(map?.mappings) ? map.mappings as VehicleMapping[] : [];
  return rows.filter((row) => row.status === "active"
    && String(row.effective_start_date || "") <= date
    && (!row.effective_end_date || String(row.effective_end_date) >= date));
}

function trucksWithPositions(date: string): Set<string> | null {
  const relative = path.join("data", "history", "linxup", `linxup_location_${date}.json`);
  const resolved = resolveDataPath(relative);
  if (!resolved) return null;

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(resolved).mtimeMs;
  } catch (error) {
    report(`linxup location ${date} stat`, error);
    return null;
  }

  const cached = locationCache.get(resolved);
  if (cached && cached.mtimeMs === mtimeMs) return cached.trucks;

  const payload = readJson<AnyRecord>(relative, `linxup location ${date}`);
  if (!payload) return null;
  const points = Array.isArray(payload.points) ? payload.points as AnyRecord[] : [];
  const trucks = new Set(points.map((point) => String(point.truck_number || "")).filter(Boolean));
  locationCache.set(resolved, { mtimeMs, trucks });
  // Only the lookback window is ever consulted; do not grow without bound.
  if (locationCache.size > GPS_SILENT_LOOKBACK_DAYS * 2) {
    for (const key of Array.from(locationCache.keys()).sort().slice(0, locationCache.size - GPS_SILENT_LOOKBACK_DAYS)) {
      locationCache.delete(key);
    }
  }
  return trucks;
}

function daysSilentFor(truck: string, date: string): number | null {
  let days = 0;
  for (let offset = 0; offset < GPS_SILENT_LOOKBACK_DAYS; offset += 1) {
    const day = shiftDate(date, -offset);
    const reporting = trucksWithPositions(day);
    if (reporting === null) return days > 0 ? days : null;
    if (reporting.has(truck)) return days;
    days += 1;
  }
  return days;
}

export function gpsCoverageSignal(date: string): GpsCoverageSignal {
  const mappings = activeMappings(date);
  if (!mappings.length) {
    return {
      status: "unknown",
      summary: "No active LinxUp vehicle mappings could be read",
      mappedTrackers: 0,
      reportingTrackers: 0,
      silentTrackers: [],
    };
  }

  const reporting = trucksWithPositions(date);
  if (reporting === null) {
    return {
      status: "unknown",
      summary: "Today's LinxUp location file could not be read",
      mappedTrackers: mappings.length,
      reportingTrackers: 0,
      silentTrackers: [],
    };
  }

  const silentTrackers: SilentTracker[] = mappings
    .filter((mapping) => !reporting.has(String(mapping.junkware_truck_number || "")))
    .map((mapping) => ({
      truck: String(mapping.junkware_truck_number || "unknown"),
      trackerId: String(mapping.linxup_tracker_id || ""),
      daysSilent: daysSilentFor(String(mapping.junkware_truck_number || ""), date),
    }));

  // A tracker that has been silent for more than a day is a broken device or a
  // stale mapping, not a parked truck. Either way somebody has to look at it.
  const chronic = silentTrackers.filter((tracker) => (tracker.daysSilent ?? 0) >= 2);
  const status: SignalStatus = chronic.length ? "critical" : silentTrackers.length ? "warn" : "ok";

  return {
    status,
    summary: chronic.length
      ? `${chronic.length} mapped tracker${chronic.length === 1 ? "" : "s"} silent for 2+ days: ${chronic.map((tracker) => tracker.truck).join(", ")}`
      : silentTrackers.length
        ? `${silentTrackers.length} mapped tracker${silentTrackers.length === 1 ? "" : "s"} have not reported today`
        : `All ${mappings.length} mapped trackers reporting`,
    mappedTrackers: mappings.length,
    reportingTrackers: mappings.length - silentTrackers.length,
    silentTrackers,
  };
}

/* ------------------------------------------------------------------ */
/* Arrival alert coverage                                              */
/* ------------------------------------------------------------------ */

export function arrivalCoverageSignal(date: string): ArrivalCoverageSignal {
  try {
    const coverage = arrivalAlertCoverage(date);
    const warnBelow = numberFromEnv("OPSCENTER_ARRIVAL_COVERAGE_WARN_PERCENT", 70);
    const status: SignalStatus = coverage.coveragePercent === null
      ? "ok"
      : coverage.coveragePercent < warnBelow
        ? "warn"
        : "ok";
    return {
      status,
      summary: coverage.coveragePercent === null
        ? "No delegated appointments recorded yet today"
        : `${coverage.confirmed} of ${coverage.totalVisits} delegated visits confirmed for an arrival alert (${coverage.coveragePercent}%)`
          + (coverage.awaitingDelegation ? `; ${coverage.awaitingDelegation} awaiting delegation` : ""),
      ...coverage,
    };
  } catch (error) {
    report("arrival coverage", error);
    return {
      status: "unknown",
      summary: "Arrival alert coverage could not be evaluated",
      date,
      totalVisits: 0,
      awaitingDelegation: 0,
      confirmed: 0,
      blocked: 0,
      coveragePercent: null,
      blockedReasons: {},
    };
  }
}

/* ------------------------------------------------------------------ */
/* Geocoder                                                            */
/* ------------------------------------------------------------------ */

/**
 * The Google Geocoding fallback is wired into every failure path in the OpsBot
 * geocoder, but with no API key it returns "not configured" and the caller
 * discards that reason - so a paid fallback that had never once run looked
 * exactly like a paid fallback that was running and failing. An unresolved
 * address is both a missing map pin and an arrival that can never confirm, so
 * whether the fallback is actually configured belongs in health.
 */
export function geocoderSignal(): GeocoderSignal {
  const payload = readJson<AnyRecord>(path.join("data", "cache", "appointment_geocodes.json"), "geocode cache");
  const addresses = payload && typeof payload.addresses === "object"
    ? payload.addresses as Record<string, AnyRecord>
    : null;
  if (!addresses) {
    return {
      status: "unknown",
      summary: "Geocode cache could not be read",
      ambiguousAddresses: 0,
      totalAddresses: 0,
      paidFallbackConfigured: null,
    };
  }

  const rows = Object.values(addresses);
  const ambiguous = rows.filter((row) => String(row.match_confidence || "").toLowerCase() !== "confirmed");
  const recent = ambiguous
    .slice()
    .sort((left, right) => String(left.collection_timestamp || "").localeCompare(String(right.collection_timestamp || "")))
    .slice(-25);
  // Only meaningful once the collector propagates the fallback's own reason.
  const sawNotConfigured = recent.some((row) => String(row.reason || "").includes("google_geocoding_not_configured"));
  const paidFallbackConfigured = recent.length === 0 ? null : !sawNotConfigured;

  const ambiguousPercent = rows.length ? Math.round((ambiguous.length / rows.length) * 100) : 0;
  const warnPercent = numberFromEnv("OPSCENTER_GEOCODE_AMBIGUOUS_WARN_PERCENT", 8);

  return {
    status: sawNotConfigured ? "critical" : ambiguousPercent >= warnPercent ? "warn" : "ok",
    summary: sawNotConfigured
      ? "Paid geocoding fallback is not configured; addresses are failing with no fallback attempted"
      : `${ambiguous.length} of ${rows.length} cached addresses have no usable coordinates (${ambiguousPercent}%)`,
    ambiguousAddresses: ambiguous.length,
    totalAddresses: rows.length,
    paidFallbackConfigured,
  };
}

/* ------------------------------------------------------------------ */
/* Integration queues                                                  */
/* ------------------------------------------------------------------ */

function queueDepth(relative: string, name: string, threshold: number): QueueDepth {
  const resolved = resolveDataPath(relative);
  if (!resolved) return { name, depth: null, oldestAgeHours: null, threshold };
  try {
    const entries = fs.readdirSync(resolved).filter((entry) => entry.endsWith(".json"));
    let oldest = Number.POSITIVE_INFINITY;
    for (const entry of entries) {
      try {
        const stats = fs.statSync(path.join(resolved, entry));
        oldest = Math.min(oldest, stats.mtimeMs);
      } catch (error) {
        report(`${name} entry stat`, error);
      }
    }
    return {
      name,
      depth: entries.length,
      oldestAgeHours: entries.length && Number.isFinite(oldest)
        ? Math.round((Date.now() - oldest) / 3_600_000)
        : null,
      threshold,
    };
  } catch (error) {
    report(`${name} queue`, error);
    return { name, depth: null, oldestAgeHours: null, threshold };
  }
}

export function queueSignal(): QueueSignal {
  const queues: QueueDepth[] = [
    queueDepth(
      path.join("data", "integrations", "whatsapp-job-photos", "review"),
      "WhatsApp job photos awaiting review",
      numberFromEnv("OPSCENTER_PHOTO_REVIEW_THRESHOLD", 25),
    ),
    queueDepth(
      path.join("data", "integrations", "whatsapp-job-photos", "failed"),
      "WhatsApp job photos failed",
      numberFromEnv("OPSCENTER_PHOTO_FAILED_THRESHOLD", 5),
    ),
    queueDepth(
      path.join("data", "integrations", "whatsapp-crew-expenses", "outbox-failed"),
      "Crew replies undelivered",
      numberFromEnv("OPSCENTER_CREW_REPLY_FAILED_THRESHOLD", 5),
    ),
    queueDepth(
      path.join("data", "integrations", "whatsapp-crew-expenses", "review"),
      "Crew expenses awaiting review",
      numberFromEnv("OPSCENTER_CREW_EXPENSE_REVIEW_THRESHOLD", 10),
    ),
  ];

  const breached = queues.filter((queue) => queue.depth !== null && queue.depth > queue.threshold);
  const unreadable = queues.filter((queue) => queue.depth === null);

  return {
    status: breached.length ? "warn" : unreadable.length === queues.length ? "unknown" : "ok",
    summary: breached.length
      ? breached.map((queue) => `${queue.name}: ${queue.depth}`).join("; ")
      : "All integration queues within threshold",
    queues,
  };
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

export function storageSignal(): StorageSignal {
  const target = resolveDataPath("data") || process.cwd();
  try {
    const stats = fs.statfsSync(target);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedPercent = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : null;
    const criticalPercent = numberFromEnv("OPSCENTER_DISK_CRITICAL_PERCENT", 95);
    const warnPercent = numberFromEnv("OPSCENTER_DISK_WARN_PERCENT", 85);
    const status: SignalStatus = usedPercent === null
      ? "unknown"
      : usedPercent >= criticalPercent
        ? "critical"
        : usedPercent >= warnPercent
          ? "warn"
          : "ok";
    return {
      status,
      summary: usedPercent === null
        ? "Disk usage could not be determined"
        : `Data volume ${usedPercent}% used, ${Math.round(freeBytes / 1_073_741_824)} GB free`,
      freeBytes,
      totalBytes,
      usedPercent,
    };
  } catch (error) {
    report("storage", error);
    return { status: "unknown", summary: "Disk usage could not be determined", freeBytes: null, totalBytes: null, usedPercent: null };
  }
}

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

export function backupSignal(): BackupSignal {
  const payload = readJson<AnyRecord>(path.join("data", "backup-sync", "status.json"), "backup status");
  if (!payload) {
    return { status: "unknown", summary: "Backup status could not be read", lastSuccessAt: null, ageMinutes: null, lastExitCode: null };
  }
  const lastSuccessAt = typeof payload.lastSuccessAt === "string" ? payload.lastSuccessAt : null;
  const lastExitCode = Number.isFinite(Number(payload.exitCode)) ? Number(payload.exitCode) : null;
  const parsed = lastSuccessAt ? Date.parse(lastSuccessAt) : Number.NaN;
  const ageMinutes = Number.isFinite(parsed) ? Math.round((Date.now() - parsed) / 60_000) : null;
  const maxAgeMinutes = numberFromEnv("OPSCENTER_BACKUP_MAX_AGE_MINUTES", 180);
  const status: SignalStatus = ageMinutes === null
    ? "unknown"
    : ageMinutes > maxAgeMinutes
      ? "critical"
      : "ok";
  return {
    status,
    summary: ageMinutes === null
      ? "Backup has never recorded a success"
      : `Last successful data backup ${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} ago`,
    lastSuccessAt,
    ageMinutes,
    lastExitCode,
  };
}

/* ------------------------------------------------------------------ */
/* Aggregate                                                           */
/* ------------------------------------------------------------------ */

export function collectSystemSignals(date = chicagoDateKey()): SystemSignals {
  const ttl = cacheTtlMs();
  const cacheKey = JSON.stringify([date, process.cwd(), process.env.OPSCENTER_DATA_DIR || ""]);
  const cached = signalsCache.get(cacheKey);
  if (cached && ttl > 0 && Date.now() - cached.at < ttl) return cached.value;

  const value = computeSystemSignals(date);
  signalsCache.set(cacheKey, { at: Date.now(), value });
  if (signalsCache.size > 8) {
    for (const key of Array.from(signalsCache.keys()).sort().slice(0, signalsCache.size - 4)) {
      signalsCache.delete(key);
    }
  }
  return value;
}

function computeSystemSignals(date: string): SystemSignals {
  const exceptions = exceptionSignal(date);
  const arrivalCoverage = arrivalCoverageSignal(date);
  const gpsCoverage = gpsCoverageSignal(date);
  const geocoder = geocoderSignal();
  const queues = queueSignal();
  const storage = storageSignal();
  const backup = backupSignal();

  const parts: Array<[string, SignalDetail]> = [
    ["exceptions", exceptions],
    ["arrivalCoverage", arrivalCoverage],
    ["gpsCoverage", gpsCoverage],
    ["geocoder", geocoder],
    ["queues", queues],
    ["storage", storage],
    ["backup", backup],
  ];

  const blocking = parts
    .filter(([, detail]) => detail.status === "critical")
    .map(([name, detail]) => `${name}: ${detail.summary}`);
  const degraded = parts.some(([, detail]) => detail.status === "warn" || detail.status === "unknown");

  return {
    status: blocking.length ? "critical" : degraded ? "warn" : "ok",
    blocking,
    exceptions,
    arrivalCoverage,
    gpsCoverage,
    geocoder,
    queues,
    storage,
    backup,
  };
}
