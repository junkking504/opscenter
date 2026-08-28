import assert from "node:assert/strict";
import { summarizeCommandSchedule } from "@/lib/command-map-data";

const summary = summarizeCommandSchedule([
  { statusBucket: "Completed" },
  { statusBucket: "Completed" },
  { statusBucket: "Estimate" },
  { statusBucket: "Estimate" },
  { statusBucket: "Open / Scheduled" },
  { statusBucket: "Unclosed or Needs Attention" },
  { statusBucket: "Canceled" },
]);

assert.deepEqual(summary, {
  scheduled: 6,
  closed: 4,
  completedJobs: 2,
  closedEstimates: 2,
  remaining: 2,
});

console.log("Command schedule summary verifies closed estimates without counting them as completed jobs.");
