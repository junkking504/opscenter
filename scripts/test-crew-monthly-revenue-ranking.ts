import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sortCrewPerformanceByRevenue, type CrewPerformanceStats } from "../lib/crew-pay-portal";

const row = (name: string, creditedRevenue: number, jobsCompleted: number): CrewPerformanceStats => ({
  name,
  creditedRevenue,
  jobRevenueWorked: creditedRevenue,
  jobsCompleted,
  averageJobSize: 0,
  estimateCloseRate: null,
  tips: 0,
  bonuses: 0,
});

assert.deepEqual(
  sortCrewPerformanceByRevenue([
    row("Jobs First", 8_000, 20),
    row("Revenue First", 9_000, 10),
    row("Revenue Tie More Jobs", 9_000, 12),
  ]).map((item) => item.name),
  ["Revenue Tie More Jobs", "Revenue First", "Jobs First"],
  "Monthly ranking must use credited revenue first, then completed jobs.",
);

const portal = readFileSync(new URL("../lib/crew-pay-portal.ts", import.meta.url), "utf8");
assert.ok(portal.includes("monthlyLeaderboard = crewPerformanceRange"), "Monthly leaderboard must be calculated through Crew performance data.");
assert.ok(portal.includes("{ rankByRevenue: true }"), "Only the monthly leaderboard must opt into revenue-first ranking.");
const page = readFileSync(new URL("../app/my-pay/page.tsx", import.meta.url), "utf8");
assert.ok(page.includes("Ranked by revenue, then jobs completed."), "Monthly leaderboard copy must describe revenue-first ranking.");

console.log("Crew monthly revenue ranking checks passed.");
