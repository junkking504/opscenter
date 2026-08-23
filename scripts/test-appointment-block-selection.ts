import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const jobsMapSource = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");

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

console.log("Appointment block selection checks passed.");
