import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { titleCaseLabel } from "../lib/title-case";

assert.equal(titleCaseLabel("Daily command"), "Daily Command");
assert.equal(titleCaseLabel("Preventive-service planner"), "Preventive-Service Planner");
assert.equal(titleCaseLabel("Today’s crew"), "Today’s Krewe");
assert.equal(titleCaseLabel("QBO connection status"), "QBO Connection Status");
assert.equal(titleCaseLabel("Expenses & earnings"), "Expenses & Earnings");

const jobsMapSource = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");
for (const label of [">Unassigned</span>", ">GPS</span>", ">Visited</span>", ">On Site", ">New Orleans</span>", ">Baton Rouge</span>", ">Northshore</span>", ">Jefferson Parish</span>", ">Lafayette</span>"]) {
  assert.ok(jobsMapSource.includes(label), `Dispatch legend is missing ${label}`);
}
for (const retiredLabel of [
  "Unassigned · muted territory color",
  "Visited · not closed out",
  "Truck at job ·",
]) {
  assert.ok(!jobsMapSource.includes(retiredLabel), `Dispatch legend still includes ${retiredLabel}`);
}
assert.ok(jobsMapSource.includes("timelineHourLabel(hour)"), "Dispatch timeline must use compact hour labels.");
assert.ok(jobsMapSource.includes('canceled ? "×" : ""'), "Canceled map pins must use a cancellation marker instead of a territory color.");

const jobsMapCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
for (const selector of [
  ".ops-jobs-map-pin.is-new-orleans.is-completed",
  ".ops-jobs-map-pin.is-jefferson.is-completed",
  ".ops-jobs-map-pin.is-northshore.is-completed",
  ".ops-jobs-map-pin.is-baton-rouge.is-completed",
]) {
  assert.ok(!jobsMapCss.includes(selector), `${selector} must not override the map territory color.`);
}
assert.ok(jobsMapCss.includes(".ops-jobs-map-pin i.is-canceled"), "Canceled map pins must preserve the territory color with a red X badge.");

const jobsPageSource = readFileSync(new URL("../app/(protected)/jobs/page.tsx", import.meta.url), "utf8");
assert.ok(jobsPageSource.includes("territoryAbbreviation(territory)"), "Territory jump controls must use compact territory labels.");
assert.ok(jobsPageSource.includes("compact\n      />"), "Schedule header must use the compact non-overlapping layout.");

const commandPageSource = readFileSync(new URL("../app/(protected)/page.tsx", import.meta.url), "utf8");
assert.ok(commandPageSource.includes('{ label: "Krewe Snapshot", href: `/?date=${date}&section=crew`'), "Command must distinguish its Krewe Snapshot from the full Krewe page.");
assert.ok(commandPageSource.includes('{ label: "Fleet Snapshot", href: `/?date=${date}&section=fleet`'), "Command must distinguish its Fleet Snapshot from the full Fleet page.");
assert.ok(commandPageSource.includes('>Full Fleet View</a>'), "Command Fleet Snapshot must link to the full Fleet view.");
assert.ok(commandPageSource.includes("<th>Krewe</th>"), "Command leaderboard must use the Krewe product name.");
assert.ok(commandPageSource.includes("<th>RPH</th>") && commandPageSource.includes("<th>AJS</th>"), "Command leaderboard must use compact RPH and AJS headings.");

const crewPageSource = readFileSync(new URL("../app/(protected)/crew/page.tsx", import.meta.url), "utf8");
const navItemsSource = readFileSync(new URL("../components/navItems.ts", import.meta.url), "utf8");
const crewLoginSource = readFileSync(new URL("../app/crew-login/page.tsx", import.meta.url), "utf8");
const myPaySourceCopy = readFileSync(new URL("../app/my-pay/page.tsx", import.meta.url), "utf8");
for (const retiredCopy of ["Crew Snapshot", "Crew member", "Daily Crew Leaderboard", "OpsCenter Crew"]) {
  assert.ok(!`${commandPageSource}\n${crewPageSource}\n${navItemsSource}\n${crewLoginSource}\n${myPaySourceCopy}`.includes(retiredCopy), `Visible product copy still includes ${retiredCopy}.`);
}

const commandBriefSource = readFileSync(new URL("../components/CommandBrief.tsx", import.meta.url), "utf8");
const metricStripSource = commandBriefSource.slice(commandBriefSource.indexOf("styles.metricStrip"), commandBriefSource.indexOf("styles.body"));
assert.ok(!metricStripSource.includes("statusLabel[metric.status]"), "Command metric cards must not repeat their color status in text.");

const loginPageSource = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
assert.ok(loginPageSource.includes("This browser stays trusted for 30 days"), "Login must state the current trusted-device duration.");
assert.ok(!loginPageSource.includes("trusted for one year"), "Login must not advertise the retired one-year device trust.");

const myPaySource = readFileSync(new URL("../app/my-pay/page.tsx", import.meta.url), "utf8");
const payPeriodStart = myPaySource.indexOf("function PayPeriodView");
const payPeriodEnd = myPaySource.indexOf("function MonthlyLeaderboardView");
assert.ok(payPeriodStart >= 0 && payPeriodEnd > payPeriodStart, "Crew Portal pay-period view is missing.");
const payPeriodSource = myPaySource.slice(payPeriodStart, payPeriodEnd);
for (const employeeSection of ["Your Pay Period", "Pay Breakdown", "Pay History"]) {
  assert.ok(payPeriodSource.includes(employeeSection), `Crew Portal pay-period view is missing ${employeeSection}.`);
}
for (const crewComparison of ["CrewMetricsTable", "All crewmembers", "Crew Pay Period Metrics"]) {
  assert.ok(!payPeriodSource.includes(crewComparison), `Crew Portal pay-period view still includes ${crewComparison}.`);
}

const dailyViewStart = myPaySource.indexOf("function DailyPerformanceView");
const dailyViewEnd = myPaySource.indexOf("function DailyRows");
assert.ok(dailyViewStart >= 0 && dailyViewEnd > dailyViewStart, "Crew Portal daily view is missing.");
const dailyViewSource = myPaySource.slice(dailyViewStart, dailyViewEnd);
assert.ok(dailyViewSource.includes("daily\n"), "Daily crew metrics must use the compact daily column set.");
assert.ok(dailyViewSource.includes("Today’s jobs, average job size, credited revenue, and tips."), "Daily crew metrics copy must describe the visible columns.");
assert.ok(!dailyViewSource.includes("estimate close rate, tips, and bonus days"), "Daily crew metrics still describe retired columns.");

const crewPayPeriodCardsSource = readFileSync(new URL("../components/CrewPayPeriodCards.tsx", import.meta.url), "utf8");
const dailySummaryStart = crewPayPeriodCardsSource.indexOf('<summary className="ops-crew-period-day-summary">');
const dailySummaryEnd = crewPayPeriodCardsSource.indexOf('<div className="ops-crew-period-day-card-body">', dailySummaryStart);
assert.ok(dailySummaryStart >= 0 && dailySummaryEnd > dailySummaryStart, "Crew pay-period daily summary is missing.");
const dailySummarySource = crewPayPeriodCardsSource.slice(dailySummaryStart, dailySummaryEnd);
assert.ok(dailySummarySource.includes(">Hourly Pay</span>"), "Crew daily summary is missing Hourly Pay.");
assert.ok(
  dailySummarySource.includes("money(day.hourlyLaborCostDisplay)"),
  "Crew daily summary Hourly Pay must use the overtime-aware hourly-pay total.",
);

const fleetPageSource = readFileSync(new URL("../app/(protected)/fleet/page.tsx", import.meta.url), "utf8");
assert.ok(
  fleetPageSource.includes('const mapPayload = section === "overview" ? buildFleetMapPayload(date, selectedTruck) : null;'),
  "Fleet map data must only be built for the active Overview section.",
);
assert.ok(
  fleetPageSource.includes('{section === "overview" && mapPayload ? <div id="fleet-map"><FleetMapClient payload={mapPayload} /></div> : null}'),
  "Fleet map polling must not remain mounted in hidden Fleet sections.",
);

const marketingCss = readFileSync(new URL("../app/(protected)/marketing/marketing.css", import.meta.url), "utf8");
assert.match(
  marketingCss,
  /\.ops-marketing-kpis > \.ops-kpi-card\s*\{\s*height: auto;\s*min-height: 74px;/,
  "Marketing KPI cards must grow for explanatory subtext.",
);
assert.match(
  marketingCss,
  /\.ops-marketing-kpis \.ops-kpi-sub\s*\{[\s\S]*?-webkit-line-clamp: 2;/,
  "Marketing KPI subtext must wrap cleanly and clamp to two lines.",
);

console.log("OpsCenter UI copy checks passed.");
