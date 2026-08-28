import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/my-pay/page.tsx", import.meta.url), "utf8");
const payPeriod = page.slice(page.indexOf("function PayPeriodView"), page.indexOf("function MonthlyLeaderboardView"));
const leaderboard = page.slice(page.indexOf("function MonthlyLeaderboardView"), page.indexOf("function TodayCrewNotes"));

assert.equal((payPeriod.match(/sectionHeaderCentered/g) || []).length, 3, "All Pay Period section titles must use the centered heading layout.");
assert.equal((leaderboard.match(/sectionHeaderCentered/g) || []).length, 2, "Both Leaderboard section titles must use the centered heading layout.");
assert.ok(payPeriod.includes("Your Pay Period") && payPeriod.includes("Pay Breakdown") && payPeriod.includes("Pay History"));
assert.ok(leaderboard.includes("Monthly Leaderboard") && leaderboard.includes("Month-to-Date Metrics"));

console.log("Crew Pay Period and Leaderboard heading alignment checks passed.");
