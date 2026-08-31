import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeLinxupV3Position } from "../lib/linxup-push";

type RecordValue = Record<string, unknown>;
type VehicleMapping = {
  junkware_truck_number: string;
  linxup_tracker_id: string;
  linxup_vehicle_name: string;
  effective_start_date: string;
  effective_end_date?: string | null;
  status: string;
};

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function chicagoDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function readJson(file: string): RecordValue {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" ? value as RecordValue : {};
  } catch {
    return {};
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function activeMapping(mappings: VehicleMapping[], name: string, trackerId: string, date: string): VehicleMapping | undefined {
  return mappings.find((mapping) => mapping.status === "active"
    && (mapping.linxup_vehicle_name.trim().toLowerCase() === name.trim().toLowerCase()
      || (Boolean(trackerId) && mapping.linxup_tracker_id.trim() === trackerId))
    && mapping.effective_start_date <= date
    && (!mapping.effective_end_date || mapping.effective_end_date >= date));
}

const providerPayload = readJson(requiredArgument("--payload-file"));
const payload = normalizeLinxupV3Position(providerPayload);
if (!payload) {
  throw new Error("Push payload does not contain a LinxUp position.");
}
const positionDate = payload.positionDate;
const latitude = payload.latitude;
const longitude = payload.longitude;
const serviceDate = chicagoDate(positionDate);
const dataRoot = String(process.env.OPSCENTER_DATA_DIR || "").trim() || path.join(process.cwd(), "data");
const map = readJson(path.join(dataRoot, "config", "linxup_vehicle_map.json"));
const tracker = payload.tracker && typeof payload.tracker === "object" ? payload.tracker as RecordValue : {};
const trackerName = String(tracker.name || "").trim();
const trackerId = String(tracker.trackerId ?? tracker.id ?? "").trim();
const mapping = activeMapping(Array.isArray(map.mappings) ? map.mappings as VehicleMapping[] : [], trackerName, trackerId, serviceDate);
if (!mapping) {
  throw new Error(`No active LinxUp vehicle mapping for tracker ${trackerName || trackerId || "unknown"}.`);
}

const history = path.join(dataRoot, "history", "linxup");
const sourcePositionId = `${trackerId || mapping.linxup_tracker_id}-${positionDate}`.replace(/[^A-Za-z0-9._-]+/g, "-");
const rawFile = path.join(history, "push", serviceDate, `position-${sourcePositionId}.json`);
const locationFile = path.join(history, `linxup_location_${serviceDate}.json`);
const receivedAt = new Date().toISOString();
writeJson(rawFile, { schema_version: 1, source: "LinxUp V3 Push API", received_at: receivedAt, payload: providerPayload });
const current = readJson(locationFile);
const currentPoints = Array.isArray(current.points) ? current.points.filter((point): point is RecordValue => Boolean(point) && typeof point === "object") : [];
const point = {
  timestamp: new Date(positionDate).toISOString(),
  tracker_id: mapping.linxup_tracker_id,
  truck_number: mapping.junkware_truck_number,
  latitude,
  longitude,
  speed: Number(payload.speed) || 0,
  ignition_state: typeof payload.engineOn === "boolean" ? (payload.engineOn ? "ON" : "OFF") : String(payload.status || ""),
  heading: payload.heading || payload.direction || null,
  source_record_id: `v3-position-${sourcePositionId}`,
  delivery_source: "v3_position_push",
  received_at: receivedAt,
};
const key = `${point.tracker_id}|${point.timestamp}|${point.latitude.toFixed(7)}|${point.longitude.toFixed(7)}`;
const points = [...currentPoints.filter((candidate) => `${candidate.tracker_id}|${candidate.timestamp}|${Number(candidate.latitude).toFixed(7)}|${Number(candidate.longitude).toFixed(7)}` !== key), point]
  .sort((left, right) => `${left.timestamp}|${left.tracker_id}`.localeCompare(`${right.timestamp}|${right.tracker_id}`));
writeJson(locationFile, {
  ...current,
  schema_version: 1,
  source: "LinxUp V3 Push API",
  date: serviceDate,
  timezone: "America/Chicago",
  collection_timestamp: receivedAt,
  delivery: {
    authoritative_source: "v3_position_push",
    current_mode: "v3_position_push",
    fallback_source: "v2_poll",
    v3_position_push: {
      latest_received_at: receivedAt,
      latest_position_at: point.timestamp,
      latest_truck: point.truck_number,
      sync_status: "current",
    },
  },
  points,
});
console.log(JSON.stringify({ accepted: true, normalized: true, serviceDate, truck: mapping.junkware_truck_number }));
