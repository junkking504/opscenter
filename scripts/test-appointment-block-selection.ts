import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const jobsMapSource = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");
const jobsCss = readFileSync(new URL("../app/(protected)/jobs/jobs.css", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const territorySource = readFileSync(new URL("../lib/appointment-territory.ts", import.meta.url), "utf8");

assert.match(
  jobsMapSource,
  /function handleAppointmentPointerDown[\s\S]*?setDraggedKey\(job\.key\);[\s\S]*?setSelectedKey\(job\.key\);/,
  "Pointer selection must acknowledge the selected appointment before a drag can suppress click.",
);
assert.match(
  jobsMapSource,
  /function handleAppointmentClick[\s\S]*?setSelectedKey\(jobKey\);[\s\S]*?const job = displayJobs\.find[\s\S]*?map\.setView\(\[job\.latitude, job\.longitude\][\s\S]*?articleId: job\.detailId/,
  "Normal appointment-block clicks must center the matching location and publish its matching card ID.",
);
assert.match(
  jobsMapSource,
  /const selectMapJob = \(job: JobsMapPoint & \{ latitude: number; longitude: number \}\) => \{[\s\S]*?focusMapArea\(\[job\]\);[\s\S]*?for \(const \{ job, latitude, longitude \} of jobMarkers\) \{[\s\S]*?addInteractiveMarker\(marker, \(\) => selectMapJob\(job\)\);/,
  "A direct appointment marker click must focus that appointment's map location.",
);
assert.match(
  jobsMapSource,
  /function showAppointmentInQueue[\s\S]*?articleId: job\.detailId[\s\S]*?getElementById\("jobs-schedule"\)\?\.scrollIntoView[\s\S]*?getElementById\(job\.detailId\)\?\.focus/,
  "The selected map appointment must provide a route to its closeout card in the Appointment Queue.",
);
assert.match(
  jobsMapSource,
  /Show in Appointments[\s\S]*?Open closeout controls/,
  "The map appointment card must expose the Appointment Queue closeout action clearly.",
);
assert.match(
  jobsMapSource,
  /"--ops-jobs-map-time-cell-min": "0px"[\s\S]*?minmax\(var\(--ops-jobs-map-time-cell-min\), 1fr\)/,
  "The board must keep all time columns inside the Dispatch pane.",
);
assert.match(
  jobsCss,
  /@media \(max-width: 700px\)[\s\S]*?\.ops-jobs-map-schedule \.ops-jobs-map-board[\s\S]*?--ops-jobs-map-time-cell-min: 0px !important/,
  "Phone appointment blocks must override the desktop cell size to fit the board in view.",
);
assert.match(
  jobsMapSource,
  /const completed = job\.statusBucket === "Completed";[\s\S]*?ops-jobs-map-pin-check[\s\S]*?✓/,
  "Completed appointments must render a checkmark in their map marker.",
);
assert.match(
  globalCss,
  /\.ops-jobs-map-pin \.ops-jobs-map-pin-check[\s\S]*?background: #16a34a;[\s\S]*?font-size: 10px/,
  "The completed map-marker checkmark must remain an unmistakable green badge at compact locator size.",
);
assert.match(
  jobsMapSource,
  /const markerLabel = `\$\{job\.appointmentTime\} · \$\{job\.customerName\} · \$\{job\.jkNumber\} · \$\{scheduleJobState\(job\)\.label\}`/,
  "Completed marker labels must expose their status to keyboard and assistive-technology users.",
);
assert.match(
  territorySource,
  /WESTBANK_LOCATION[\s\S]*?if \(WESTBANK_LOCATION\.test\(location\)\) return "Westbank"/,
  "South Bank appointments must be classified as Westbank.",
);
assert.match(
  jobsMapSource,
  /territory\.includes\("westbank"\)\) tone = "is-westbank"/,
  "Westbank appointments must retain their Dispatch indicator class.",
);
assert.match(
  globalCss,
  /\.is-westbank\.is-assigned-unfinished \{ background: #f59e0b; \}/,
  "Assigned Westbank appointments must display with the amber-orange indicator.",
);
assert.match(
  readFileSync(new URL("../app/ops-usability.css", import.meta.url), "utf8"),
  /\.ops-map-cluster:is\(\.is-appointments, \.is-locations\)\.is-westbank \{ background: #f59e0b; \}/,
  "Westbank appointment clusters must display orange.",
);
assert.match(
  jobsMapSource,
  /function isEastMetroJob[\s\S]*?new\\s\+orleans\\s\+east[\s\S]*?chalmette[\s\S]*?701\(\?:26\|27\|28\|29\)[\s\S]*?70043/,
  "New Orleans East and Chalmette must retain their yellow Dispatch presentation zone.",
);
assert.match(
  globalCss,
  /\.is-east-metro\.is-assigned-unfinished \{ background: #facc15; \}/,
  "Assigned New Orleans East and Chalmette appointments must display yellow on the board.",
);

console.log("Appointment block selection checks passed.");
