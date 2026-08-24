import assert from "node:assert/strict";
import { monthlyLeaderboardSummary, type CrewPerformanceRange } from "../lib/crew-pay-portal";

const range: CrewPerformanceRange = {
  start: "2026-08-01",
  end: "2026-08-31",
  rows: [],
  totalRevenue: 9_368.79,
  totalJobs: 17,
  totalHours: 60.72,
  totalTips: 861.69,
  estimateCloseRate: null,
};

assert.deepEqual(monthlyLeaderboardSummary(range), {
  averageJobSize: 551.11,
  revenuePerHour: 154.29,
});
assert.deepEqual(monthlyLeaderboardSummary({ ...range, totalJobs: 0, totalHours: 0 }), {
  averageJobSize: null,
  revenuePerHour: null,
});

console.log("Crew portal monthly summary checks passed.");
