import assert from "node:assert/strict";
import { titleCaseLabel } from "../lib/title-case";

assert.equal(titleCaseLabel("Daily command"), "Daily Command");
assert.equal(titleCaseLabel("Preventive-service planner"), "Preventive-Service Planner");
assert.equal(titleCaseLabel("Today’s crew"), "Today’s Crew");
assert.equal(titleCaseLabel("QBO connection status"), "QBO Connection Status");
assert.equal(titleCaseLabel("Expenses & earnings"), "Expenses & Earnings");

console.log("OpsCenter UI copy checks passed.");
