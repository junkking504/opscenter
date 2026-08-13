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

console.log("OpsCenter UI copy checks passed.");
