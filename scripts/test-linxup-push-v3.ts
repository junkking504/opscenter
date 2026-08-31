import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeLinxupV3Position } from "../lib/linxup-push";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function chicagoDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const now = Date.now();
const officialPayload = {
  date: now - 1_000,
  latitude: 30.2241,
  longitude: -92.0198,
  speed: 17,
  heading: "NE",
  engineOn: true,
  tracker: { trackerId: 12345, name: "Truck 2" },
};
const normalized = normalizeLinxupV3Position(officialPayload, now);
expect(normalized?.positionDate === officialPayload.date, "Official V3 date must normalize to positionDate");
expect(normalized?.date === officialPayload.date, "Official V3 date must be retained");
expect(normalized?.tracker.trackerId === 12345, "Official V3 tracker identity must be retained");

expect(Boolean(normalizeLinxupV3Position({ ...officialPayload, date: undefined, positionDate: officialPayload.date }, now)),
  "Legacy positionDate payloads must remain compatible");
expect(!normalizeLinxupV3Position({ ...officialPayload, date: now + 10 * 60 * 1000 }, now),
  "Future-dated V3 positions must be rejected");
expect(!normalizeLinxupV3Position({ ...officialPayload, tracker: undefined }, now),
  "V3 positions without tracker identity must be rejected");

const root = process.cwd();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-linxup-v3-test-"));
try {
  const configDir = path.join(temporaryRoot, "config");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "linxup_vehicle_map.json"), JSON.stringify({
    mappings: [{
      junkware_truck_number: "2",
      linxup_tracker_id: "12345",
      linxup_vehicle_name: "Truck 2",
      effective_start_date: "2020-01-01",
      effective_end_date: null,
      status: "active",
    }],
  }));
  const payloadFile = path.join(temporaryRoot, "official-v3-position.json");
  fs.writeFileSync(payloadFile, JSON.stringify(officialPayload));
  execFileSync(process.execPath, ["--import", "tsx", "scripts/ingest-linxup-push.ts", "--payload-file", payloadFile], {
    cwd: root,
    env: { ...process.env, OPSCENTER_DATA_DIR: temporaryRoot },
    stdio: "pipe",
  });

  const date = chicagoDate(officialPayload.date);
  const snapshot = JSON.parse(fs.readFileSync(path.join(temporaryRoot, "history", "linxup", `linxup_location_${date}.json`), "utf8"));
  expect(snapshot.delivery?.current_mode === "v3_position_push", "V3 ingestion must switch the normalized snapshot to V3 authority");
  expect(snapshot.points?.[0]?.delivery_source === "v3_position_push", "V3 delivery source must survive normalization");
  expect(snapshot.points?.[0]?.ignition_state === "ON", "Official engineOn must normalize to ignition state");
  const rawFiles = fs.readdirSync(path.join(temporaryRoot, "history", "linxup", "push", date));
  expect(rawFiles.length === 1, "V3 ingestion must retain one provider payload for audit");
  const raw = JSON.parse(fs.readFileSync(path.join(temporaryRoot, "history", "linxup", "push", date, rawFiles[0]), "utf8"));
  expect(raw.payload?.date === officialPayload.date, "Raw audit record must retain the provider's official date field");

  const unmappedFile = path.join(temporaryRoot, "unmapped-v3-position.json");
  fs.writeFileSync(unmappedFile, JSON.stringify({
    ...officialPayload,
    tracker: { trackerId: 99999, name: "Unmapped Truck" },
  }));
  let unmappedFailed = false;
  try {
    execFileSync(process.execPath, ["--import", "tsx", "scripts/ingest-linxup-push.ts", "--payload-file", unmappedFile], {
      cwd: root,
      env: { ...process.env, OPSCENTER_DATA_DIR: temporaryRoot },
      stdio: "pipe",
    });
  } catch {
    unmappedFailed = true;
  }
  expect(unmappedFailed, "Unmapped V3 positions must fail so LinxUp can retry instead of silently dropping them");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("LinxUp V3 push contract checks passed.");
