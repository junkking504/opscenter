import assert from "node:assert/strict";
import { commandMapPoint, summarizeCommandSchedule, summarizeCommandScheduleFromMetrics } from "@/lib/command-map-data";

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
  unclosed: 2,
});

// The last-week comparison summarizes saved metrics without building a map;
// it must count exactly what the map's jobs would.
const appointments = [
  { job_status: "Completed", appointment_type: "Job" },
  { job_status: "Paid", appointment_type: "Estimate" },
  { job_status: "Canceled" },
  { job_status: "Confirmed" },
  { job_status: "Unclosed" },
  { status: "closed", appointmentType: "estimate" },
  {},
];
assert.deepEqual(
  summarizeCommandScheduleFromMetrics({ appointments }),
  summarizeCommandSchedule(appointments.map((row, index) => commandMapPoint(row, index))),
);
assert.deepEqual(summarizeCommandScheduleFromMetrics(null), summarizeCommandSchedule([]));

console.log("Command schedule summary verifies jobs, closed estimates, and unclosed appointments independently.");
