import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJunkwareFastSchedule } from "@/lib/junkware-fast-schedule";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-fast-schedule-"));
const date = "2026-08-22";
const historyDir = path.join(dataDir, "history", "junkware");
const watcherDir = path.join(historyDir, "schedule-watchers", "484");
fs.mkdirSync(watcherDir, { recursive: true });

fs.writeFileSync(path.join(historyDir, `junkware_schedule_fast_${date}.json`), JSON.stringify({
  appointments: [{ appt_id: "4048134", job_id: "JK4061312" }],
  cancelled: [],
}));
fs.writeFileSync(path.join(watcherDir, `junkware_schedule_fast_${date}.json`), JSON.stringify({
  appointments: [{ appt_id: "4048134", job_id: "JK4061312" }],
  cancelled: [{ appt_id: "4048675", job_id: "JK4061853", cancellation_status: "cancelled" }],
}));

const snapshot = readJunkwareFastSchedule(dataDir, date);
assert.equal(snapshot.appointments.length, 1);
assert.deepEqual(snapshot.cancelled.map((row) => row.appt_id), ["4048675"]);
assert.ok(snapshot.updatedAt);

fs.rmSync(dataDir, { recursive: true, force: true });
console.log("JunkWare fast schedule aggregation tests passed.");
