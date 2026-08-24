import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve("app/(protected)/jobs/page.tsx"), "utf8");
const css = readFileSync(resolve("app/(protected)/jobs/jobs.css"), "utf8");

assert.match(page, /function AppointmentCardCompletedCrew/);
assert.match(page, /statusBucket\(job\) !== "Completed"/);
assert.match(page, /safeText\(job\.assignedTruck \|\| job\.truck\)/);
assert.match(page, /D: \{driver\}/);
assert.match(page, /N: \{navigator\}/);
assert.equal(
  (page.match(/<AppointmentCardCompletedCrew job=\{job\} \/>/g) || []).length,
  2,
  "completed crew should appear in both appointment-card render paths",
);
assert.match(css, /\.ops-appointment-card-completed-crew/);

console.log("appointment completed crew contract passed");
