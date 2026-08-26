import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { titleCaseLabel } from "../lib/title-case";
import { operationalCategoryLabel } from "../lib/ops-labels";

assert.equal(titleCaseLabel("Daily command"), "Daily Command");
assert.equal(titleCaseLabel("Preventive-service planner"), "Preventive-Service Planner");
assert.equal(titleCaseLabel("Today’s krewe"), "Today’s Krewe");
assert.equal(titleCaseLabel("QBO connection status"), "QBO Connection Status");
assert.equal(titleCaseLabel("Expenses & earnings"), "Expenses & Earnings");
assert.equal(operationalCategoryLabel("Jobs"), "Schedule");
assert.equal(operationalCategoryLabel("Crew"), "Krewe");
assert.equal(operationalCategoryLabel("Fleet"), "Fleet");

const jobsMapSource = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");
for (const label of [">GPS</span>", ">Visited</span>", ">On Site"]) {
  assert.ok(jobsMapSource.includes(label), `Dispatch legend is missing ${label}`);
}
for (const abbreviation of ["NO", "BR", "NS", "JP", "LF"]) {
  assert.ok(jobsMapSource.includes(`abbreviation: "${abbreviation}"`), `Dispatch territory shortcut is missing ${abbreviation}`);
}
for (const retiredLabel of [
  "Unassigned · muted territory color",
  "Visited · not closed out",
  "Truck at job ·",
]) {
  assert.ok(!jobsMapSource.includes(retiredLabel), `Dispatch legend still includes ${retiredLabel}`);
}
assert.ok(jobsMapSource.includes("timelineHourLabel(hour)"), "Dispatch timeline must use compact hour labels.");

const jobsPageSource = readFileSync(new URL("../app/(protected)/jobs/page.tsx", import.meta.url), "utf8");
assert.ok(jobsPageSource.includes("territoryAbbreviation(territory)"), "Territory jump controls must use compact territory labels.");
assert.ok(jobsPageSource.includes("compact\n      />"), "Schedule header must use the compact non-overlapping layout.");
assert.ok(jobsPageSource.includes('"estimates"') && jobsPageSource.includes('"unclosed"'), "Schedule must retain separate open-estimates and unclosed-jobs pages.");
assert.ok(jobsPageSource.includes('label: "Open estimates"') && jobsPageSource.includes('label: "Unclosed jobs"'), "Schedule must expose separate open-estimates and unclosed-jobs tabs at the top.");
assert.ok(
  jobsPageSource.includes('kind === "estimates" ? openEstimate : bucket === "Unclosed or Needs Attention"'),
  "Each follow-up page must use its correct JunkWare status filter.",
);
assert.ok(
  jobsPageSource.includes(".sort((a, b) => followupRecency(b) - followupRecency(a)"),
  "The follow-up page must order jobs from newest to oldest.",
);

const myPaySource = readFileSync(new URL("../app/my-pay/page.tsx", import.meta.url), "utf8");
const payPeriodStart = myPaySource.indexOf("function PayPeriodView");
const payPeriodEnd = myPaySource.indexOf("function MonthlyLeaderboardView");
assert.ok(payPeriodStart >= 0 && payPeriodEnd > payPeriodStart, "Krewe Portal pay-period view is missing.");
const payPeriodSource = myPaySource.slice(payPeriodStart, payPeriodEnd);
for (const employeeSection of ["Your Pay Period", "Pay Breakdown", "Pay History"]) {
  assert.ok(payPeriodSource.includes(employeeSection), `Krewe Portal pay-period view is missing ${employeeSection}.`);
}
for (const crewComparison of ["CrewMetricsTable", "All crewmembers", "Crew Pay Period Metrics"]) {
  assert.ok(!payPeriodSource.includes(crewComparison), `Krewe Portal pay-period view still includes ${crewComparison}.`);
}

const dailyViewStart = myPaySource.indexOf("function DailyPerformanceView");
const dailyViewEnd = myPaySource.indexOf("function DailyRows");
assert.ok(dailyViewStart >= 0 && dailyViewEnd > dailyViewStart, "Krewe Portal daily view is missing.");
const dailyViewSource = myPaySource.slice(dailyViewStart, dailyViewEnd);
assert.ok(dailyViewSource.includes("daily\n"), "Daily Krewe metrics must use the compact daily column set.");
assert.ok(dailyViewSource.includes("Today’s clocked-in Krewe: jobs, average job size, credited revenue, and tips."), "Daily Krewe metrics copy must describe the clocked-in Krewe and visible columns.");
assert.ok(!dailyViewSource.includes("estimate close rate, tips, and bonus days"), "Daily Krewe metrics still describe retired columns.");

const monthlyViewStart = myPaySource.indexOf("function MonthlyLeaderboardView");
const monthlyViewEnd = myPaySource.indexOf("export default async function MyPayPage", monthlyViewStart);
assert.ok(monthlyViewStart >= 0 && monthlyViewEnd > monthlyViewStart, "Krewe Portal monthly leaderboard view is missing.");
const monthlyViewSource = myPaySource.slice(monthlyViewStart, monthlyViewEnd);
assert.ok(monthlyViewSource.includes("ranked\n"), "Monthly leaderboard must use the leaderboard metric column set.");
for (const retiredMetric of ["Estimates closed", "Bonus days", "days bonuses were received"]) {
  assert.ok(!monthlyViewSource.includes(retiredMetric), `Monthly leaderboard still includes ${retiredMetric}.`);
}

const metricsTableStart = myPaySource.indexOf("function CrewMetricsTable");
const metricsTableEnd = myPaySource.indexOf("function DailyPerformanceView", metricsTableStart);
assert.ok(metricsTableStart >= 0 && metricsTableEnd > metricsTableStart, "Krewe metrics table is missing.");
const metricsTableSource = myPaySource.slice(metricsTableStart, metricsTableEnd);
for (const leaderboardMetric of ["Jobs completed", "Revenue", "Average job size", "Tips"]) {
  assert.ok(metricsTableSource.includes(leaderboardMetric), `Leaderboard metric table is missing ${leaderboardMetric}.`);
}

const crewPortalDataSource = readFileSync(new URL("../lib/crew-pay-portal.ts", import.meta.url), "utf8");
assert.ok(crewPortalDataSource.includes("{ requireClockIn: true }"), "Daily Krewe metrics must require a recorded clock-in.");

const crewPayPeriodCardsSource = readFileSync(new URL("../components/CrewPayPeriodCards.tsx", import.meta.url), "utf8");
const dailySummaryStart = crewPayPeriodCardsSource.indexOf('<summary className="ops-crew-period-day-summary">');
const dailySummaryEnd = crewPayPeriodCardsSource.indexOf('<div className="ops-crew-period-day-card-body">', dailySummaryStart);
assert.ok(dailySummaryStart >= 0 && dailySummaryEnd > dailySummaryStart, "Krewe pay-period daily summary is missing.");
const dailySummarySource = crewPayPeriodCardsSource.slice(dailySummaryStart, dailySummaryEnd);
assert.ok(dailySummarySource.includes(">Hourly Pay</span>"), "Krewe daily summary is missing Hourly Pay.");
assert.ok(
  dailySummarySource.includes("money(day.hourlyLaborCostDisplay)"),
  "Krewe daily summary Hourly Pay must use the overtime-aware hourly-pay total.",
);

console.log("OpsCenter UI copy checks passed.");
