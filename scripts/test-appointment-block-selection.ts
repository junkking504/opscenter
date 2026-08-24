import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const jobsMapSource = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");
const jobsCss = readFileSync(new URL("../app/(protected)/jobs/jobs.css", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(
  jobsMapSource,
  /function handleAppointmentPointerDown[\s\S]*?setDraggedKey\(job\.key\);[\s\S]*?setSelectedKey\(job\.key\);/,
  "Pointer selection must acknowledge the selected appointment before a drag can suppress click.",
);
assert.match(
  jobsMapSource,
  /function handleAppointmentClick[\s\S]*?setSelectedKey\(jobKey\);[\s\S]*?const job = displayJobs\.find[\s\S]*?articleId: job\.detailId/,
  "Normal clicks must select the appointment and publish its matching card ID.",
);
assert.match(
  jobsMapSource,
  /"--ops-jobs-map-time-cell-min": "60px"[\s\S]*?minmax\(var\(--ops-jobs-map-time-cell-min\), 1fr\)/,
  "The board must expose a desktop cell-size variable for the mobile fit override.",
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
  /\.ops-jobs-map-pin \.ops-jobs-map-pin-check[\s\S]*?color: #16803c/,
  "The completed map-marker checkmark must remain green.",
);

console.log("Appointment block selection checks passed.");
