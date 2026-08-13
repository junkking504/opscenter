import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { titleCaseLabel } from "../lib/title-case";

assert.equal(titleCaseLabel("Daily command"), "Daily Command");
assert.equal(titleCaseLabel("Preventive-service planner"), "Preventive-Service Planner");
assert.equal(titleCaseLabel("Today’s crew"), "Today’s Crew");
assert.equal(titleCaseLabel("QBO connection status"), "QBO Connection Status");
assert.equal(titleCaseLabel("Expenses & earnings"), "Expenses & Earnings");

const jobsMapSource = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");
for (const label of [">Unassigned</span>", ">Visited</span>", ">On Site"]) {
  assert.ok(jobsMapSource.includes(label), `Dispatch legend is missing ${label}`);
}
for (const retiredLabel of [
  "Unassigned · muted territory color",
  "Visited · not closed out",
  "Truck at job ·",
]) {
  assert.ok(!jobsMapSource.includes(retiredLabel), `Dispatch legend still includes ${retiredLabel}`);
}

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

console.log("OpsCenter UI copy checks passed.");
