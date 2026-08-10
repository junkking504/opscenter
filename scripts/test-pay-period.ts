import assert from "node:assert/strict";
import {
  summarizeWorkWeeks as summarizeCrewCardWeeks,
  type CrewPayPeriodDayRow,
} from "../components/CrewPayPeriodCards";
import { summarizeWorkWeeks as summarizeServerWeeks } from "../lib/crew-pay-period";
import { payPeriodDates, payPeriodForDate, PAY_PERIOD_DAYS } from "../lib/pay-period";

function day(date: string): CrewPayPeriodDayRow {
  return {
    date,
    selected: false,
    today: false,
    worked: true,
    salary: false,
    hoursWorked: 8,
    clockInDisplay: "8:00 AM",
    clockOutDisplay: "4:00 PM",
    hoursDisplay: "8.00 hrs",
    roleDisplay: "Crew",
    truckDisplay: "Truck 1",
    jobs: 1,
    estimates: 0,
    estimatesClosedAsJobs: 0,
    revenue: 100,
    jobRevenueWorked: 100,
    averageJobSize: 100,
    rph: 12.5,
    hourlyRate: 20,
    regularPay: 160,
    tips: 0,
    revenueBonus: 0,
    manualBonus: 0,
    otherBonus: 0,
    bonus: 0,
    totalBonuses: 0,
    supplementalPay: 0,
    totalPay: 160,
    firstVisitCloseRateDisplay: "Unavailable",
    estimateCloseRateDisplay: "Unavailable",
    driverScoreDisplay: "Unavailable",
    driverScoreSource: "",
    driverScoreStatus: "",
    speedingEvents: null,
    harshBrakingEvents: null,
    isOpenShift: false,
  };
}

assert.equal(PAY_PERIOD_DAYS, 14);
assert.deepEqual(payPeriodForDate("2026-08-09"), { start: "2026-07-27", end: "2026-08-09" });
assert.deepEqual(payPeriodForDate("2026-08-10"), { start: "2026-08-10", end: "2026-08-23" });
assert.deepEqual(payPeriodForDate("2026-08-23"), { start: "2026-08-10", end: "2026-08-23" });
assert.deepEqual(payPeriodForDate("2026-08-24"), { start: "2026-08-24", end: "2026-09-06" });
assert.equal(payPeriodDates("2026-08-10").dates.length, 14);

const cardWeeks = summarizeCrewCardWeeks([day("2026-07-27")], "2026-07-27", "2026-08-09");
assert.deepEqual(
  cardWeeks.map((week) => ({ start: week.start, end: week.end, label: week.label, days: week.days.length })),
  [
    { start: "2026-07-27", end: "2026-08-02", label: "Week 1: 2026-07-27–2026-08-02", days: 1 },
    { start: "2026-08-03", end: "2026-08-09", label: "Week 2: 2026-08-03–2026-08-09", days: 0 },
  ],
);
assert.equal(cardWeeks[1].totals.totalHours, 0);
assert.equal(cardWeeks[1].totals.totalPay, 0);

const serverWeeks = summarizeServerWeeks([day("2026-08-03")], "2026-07-27", "2026-08-09");
assert.equal(serverWeeks.length, 2);
assert.equal(serverWeeks[0].days.length, 0);
assert.equal(serverWeeks[0].label, "Week 1: 2026-07-27–2026-08-02");
assert.equal(serverWeeks[1].days.length, 1);
assert.equal(serverWeeks[1].label, "Week 2: 2026-08-03–2026-08-09");

console.log("Pay-period verification passed: every period spans 14 days and always exposes Week 1 and Week 2.");
