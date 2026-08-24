import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const jobsMapSource = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");
const jobsCss = readFileSync(new URL("../app/(protected)/jobs/jobs.css", import.meta.url), "utf8");

assert.match(
  jobsMapSource,
  /const selectAppointment = useCallback\(\(job: JobsMapPoint\) => \{[\s\S]*?articleId:\s*job\.detailId/,
  "Appointment selection must publish the matching appointment-card ID.",
);
assert.match(
  jobsMapSource,
  /function handleAppointmentPointerDown[\s\S]*?setDraggedKey\(job\.key\);[\s\S]*?selectAppointment\(job\);/,
  "Pointer selection must acknowledge the card before a drag can suppress click.",
);
assert.match(
  jobsMapSource,
  /function handleAppointmentClick[\s\S]*?const job = displayJobs\.find[\s\S]*?if \(job\) selectAppointment\(job\);/,
  "Normal clicks must use the same appointment-selection path.",
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

console.log("Appointment block selection checks passed.");
