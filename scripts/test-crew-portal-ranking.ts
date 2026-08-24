import assert from "node:assert/strict";
import { sortCrewPerformanceByRevenue } from "../lib/crew-pay-portal";

const rows = sortCrewPerformanceByRevenue([
  { name: "More jobs", creditedRevenue: 800, jobRevenueWorked: 800, jobsCompleted: 4, averageJobSize: 200, estimateCloseRate: null, tips: 0, bonuses: 0 },
  { name: "Top revenue", creditedRevenue: 1_200, jobRevenueWorked: 1_200, jobsCompleted: 1, averageJobSize: 1_200, estimateCloseRate: null, tips: 0, bonuses: 0 },
  { name: "Revenue tie", creditedRevenue: 1_200, jobRevenueWorked: 1_200, jobsCompleted: 2, averageJobSize: 600, estimateCloseRate: null, tips: 0, bonuses: 0 },
]);

assert.deepEqual(
  rows.map(({ name }) => name),
  ["Revenue tie", "Top revenue", "More jobs"],
  "Daily crew rankings must put credited revenue first, using completed jobs only to break a revenue tie.",
);

console.log("Crew Portal revenue-ranking checks passed.");
