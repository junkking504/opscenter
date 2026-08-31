import assert from "node:assert/strict";
import { monthDisplayForDate } from "../lib/monthly-summary";

assert.equal(monthDisplayForDate("2026-01-01"), "January 2026");
assert.equal(monthDisplayForDate("2026-03-01"), "March 2026");
assert.equal(monthDisplayForDate("2026-06-01"), "June 2026");

console.log("Monthly date-label checks passed.");
