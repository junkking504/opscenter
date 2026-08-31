import assert from "node:assert/strict";
import {
  calendarMonthCells,
  calendarMonthKey,
  calendarMonthLabel,
  shiftCalendarMonth,
} from "../lib/date-calendar";

assert.equal(calendarMonthKey("2026-08-28"), "2026-08");
assert.equal(shiftCalendarMonth("2026-01", 1), "2026-02");
assert.equal(shiftCalendarMonth("2026-03", -1), "2026-02");
assert.equal(shiftCalendarMonth("2026-12", 1), "2027-01");
assert.equal(calendarMonthLabel("2026-02"), "February 2026");

const january = calendarMonthCells("2026-01").filter(Boolean);
const february = calendarMonthCells("2026-02").filter(Boolean);
const march = calendarMonthCells("2026-03").filter(Boolean);
assert.equal(january.length, 31);
assert.equal(february.length, 28);
assert.equal(march.length, 31);
assert.equal(february[0]?.date, "2026-02-01");
assert.equal(february.at(-1)?.date, "2026-02-28");

console.log("Month calendar and January/February continuity contracts passed.");
