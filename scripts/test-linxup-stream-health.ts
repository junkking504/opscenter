import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLinxupV3StreamState } from "../lib/linxup-stream-health";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "linxup-midnight-health-"));
const current = path.join(root, "linxup_location_2026-10-01.json");
const prior = path.join(root, "linxup_location_2026-09-30.json");
const now = Date.parse("2026-10-01T05:35:00Z");
const off = { tracker_id: "fixture", timestamp: "2026-10-01T02:36:16Z", delivery_source: "v3_position_push", ignition_state: "OFF", speed: 0, latitude: 30, longitude: -90 };
const poll = { ...off, timestamp: "2026-10-01T05:34:00Z", delivery_source: "v2_poll", ignition_state: "" };
const save = (file: string, date: string, points: unknown[]) => fs.writeFileSync(file, JSON.stringify({ date, points }));
try {
  save(prior, "2026-09-30", [off]);
  save(current, "2026-10-01", [poll]);
  assert.deepEqual(readLinxupV3StreamState(current, 180, now), {
    latestPositionAt: off.timestamp, fresh: false, expectedSilent: true,
  }, "Chicago midnight must not erase the last explicit ignition-off V3 observation");
  for (const movement of [{ ...poll, speed: 12 }, { ...poll, latitude: 30.01 }]) {
    save(current, "2026-10-01", [movement]);
    assert.equal(readLinxupV3StreamState(current, 180, now).expectedSilent, false, "New-day movement must expose missed push delivery");
  }
  save(current, "2026-10-01", [poll]);
  save(prior, "2026-09-30", [off, { ...poll, timestamp: "2026-10-01T04:59:00Z", speed: 12 }]);
  assert.equal(readLinxupV3StreamState(current, 180, now).expectedSilent, true, "Newer stationary poll supersedes prior movement at the same location");
  save(current, "2026-10-01", [{ ...poll, timestamp: "2026-10-01T04:58:00Z" }]);
  assert.equal(readLinxupV3StreamState(current, 180, now).expectedSilent, false, "Prior-day movement newer than current retained position must not disappear");
  save(current, "2026-10-01", [poll]);
  save(prior, "2026-09-30", [{ ...off, ignition_state: "ON" }]);
  assert.equal(readLinxupV3StreamState(current, 180, now).expectedSilent, false);
  save(prior, "2026-09-30", [{ ...off, timestamp: "invalid" }, { ...off, timestamp: "2026-10-02T00:00:00Z" }]);
  assert.equal(readLinxupV3StreamState(current, 180, now).latestPositionAt, null);
  save(prior, "2026-09-29", [off]);
  assert.equal(readLinxupV3StreamState(current, 180, now).expectedSilent, false, "Wrong-day history must not establish silence");
  fs.writeFileSync(prior, "broken");
  assert.equal(readLinxupV3StreamState(current, 180, now).expectedSilent, false);
  const fresh = { ...off, timestamp: "2026-10-01T05:34:30Z", ignition_state: "ON" };
  save(current, "2026-10-01", [fresh]);
  assert.equal(readLinxupV3StreamState(current, 180, now).fresh, true, "Bad optional history must not erase valid current V3");
  save(prior, "2026-09-30", [off]);
  assert.equal(readLinxupV3StreamState(current, 180, now).expectedSilent, false, "New-day ignition ON supersedes yesterday OFF");
  save(current, "2026-10-01", [{ ...off, ignition_state: "ON" }]);
  assert.equal(readLinxupV3StreamState(current, 180, now).expectedSilent, false, "Current snapshot wins equal-time ignition conflict");
  save(current, "2026-10-01", [null]);
  assert.equal(readLinxupV3StreamState(current, 180, now).latestPositionAt, null, "Damaged current snapshot fails closed");
  fs.unlinkSync(current);
  assert.equal(readLinxupV3StreamState(current, 180, now).expectedSilent, false, "History alone cannot validate missing current collection");
  // Calendar arithmetic is independent of host timezone and DST.
  const january = path.join(root, "linxup_location_2027-01-01.json");
  const december = path.join(root, "linxup_location_2026-12-31.json");
  save(december, "2026-12-31", [{ ...off, timestamp: "2027-01-01T05:50:00Z" }]);
  save(january, "2027-01-01", []);
  assert.equal(readLinxupV3StreamState(january, 180, Date.parse("2027-01-01T06:30:00Z")).expectedSilent, true);
  assert.ok(fs.readFileSync(path.join(process.cwd(), "app/api/health/route.ts"), "utf8").includes("readLinxupV3StreamState(linxupFile, linxupV3MaxAgeSeconds)"), "Health must use the rollover-aware reader");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("LinxUp midnight stream health checks passed.");
