import assert from "node:assert/strict";
import fs from "node:fs";

const refreshLoop = fs.readFileSync("scripts/run-junkware-live-refresh-loop.sh", "utf8");
const cadenceBlock = refreshLoop.slice(
  refreshLoop.indexOf("CYCLE_FINISHED="),
  refreshLoop.indexOf("WAIT_DEADLINE="),
);

assert.match(
  refreshLoop,
  /else\n\s+CURRENT_DATA_REFRESH_SUCCEEDED=true\n\s+auto_virtualize_external_bookings/,
  "A successful authoritative refresh must set the cadence health marker before optional integrations run.",
);
assert.match(
  cadenceBlock,
  /if \[ "\$CURRENT_DATA_REFRESH_SUCCEEDED" = true \]; then/,
  "Normal JunkWare cadence must depend on the authoritative current-data refresh.",
);
assert.doesNotMatch(
  cadenceBlock,
  /if \[ "\$PUBLISH_SUCCEEDED" = true \]; then/,
  "VPS publishing must not control JunkWare refresh backoff.",
);

const assignmentSync = fs.readFileSync("scripts/sync-junkware-truck-assignment.ts", "utf8");
const scheduleMoveHelper = assignmentSync.slice(
  assignmentSync.indexOf("async function moveAppointmentOnDailySchedule"),
  assignmentSync.indexOf("async function main"),
);

assert.match(scheduleMoveHelper, /daily-schedule\.aspx\/MoveAppointment/);
assert.match(scheduleMoveHelper, /laneNumber === truckNumber/);
assert.match(scheduleMoveHelper, /\^Virtual Truck\\b/);
assert.equal(
  (assignmentSync.match(/daily-schedule\.aspx\/MoveAppointment/g) || []).length,
  1,
  "Truck and time moves should share one fast JunkWare schedule endpoint implementation.",
);
assert.match(
  assignmentSync,
  /if \(\(truckChanged \|\| appointmentTimeChanged\) && !durationChanged\)/,
  "Normal truck/time drag operations must use the single schedule-move path.",
);
assert.match(
  assignmentSync,
  /await page\.goto\(targetUrl, \{ waitUntil: "domcontentloaded" \}\);[\s\S]*JunkWare did not retain the requested truck assignment/,
  "The fast write must still reload and verify the authoritative appointment.",
);

console.log("JunkWare synchronization latency checks passed.");
