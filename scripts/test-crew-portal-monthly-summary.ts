import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const styles = readFileSync(new URL("../app/my-pay/my-pay.module.css", import.meta.url), "utf8");
const monthSummaryStart = styles.indexOf(".monthSummary {");
const monthSummaryEnd = styles.indexOf(".performanceCard", monthSummaryStart);
const monthSummaryStyles = styles.slice(monthSummaryStart, monthSummaryEnd);
assert.ok(monthSummaryStyles.includes("grid-template-columns: repeat(5, minmax(0, 1fr))"), "Monthly summary must retain five columns.");
assert.ok(monthSummaryStyles.includes("container-type: inline-size"), "Monthly summary must scale to its container.");
assert.ok(monthSummaryStyles.includes("white-space: nowrap"), "Monthly summary labels and values must stay on one line.");

const portalSource = readFileSync(new URL("../lib/crew-pay-portal.ts", import.meta.url), "utf8");
assert.ok(portalSource.includes("reportedTips > 0 ? reportedTips : crewTips"), "Monthly tips must fall back to the Crew leaderboard total when a snapshot lacks a top-level tips total.");

console.log("Crew portal monthly summary checks passed.");
