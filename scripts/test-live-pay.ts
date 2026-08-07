import assert from "node:assert/strict";
import { calculateLivePay } from "../lib/live-pay";
import { calculateWeeklyOvertime } from "../lib/overtime";

const date = "2026-07-13";
const chicagoNow = new Date("2026-07-13T15:00:00-05:00");

const open = calculateLivePay({
  date,
  clockIn: "01:00 PM",
  hourlyRate: 20,
  totalBonus: 150,
  now: chicagoNow,
});
assert.equal(open.state, "open");
assert.equal(open.workedSeconds, 7200);
assert.equal(open.regularPay, 40);
assert.equal(open.totalPay, 190);

const openLater = calculateLivePay({
  date,
  clockIn: "01:00 PM",
  hourlyRate: 20,
  totalBonus: 150,
  now: new Date(chicagoNow.getTime() + 120000),
});
assert.ok(Number(openLater.totalPay) > Number(open.totalPay));

const closed = calculateLivePay({
  date,
  clockIn: "01:00 PM",
  clockOut: "03:00 PM",
  hourlyRate: 20,
  totalBonus: 150,
  now: new Date("2026-07-13T20:00:00-05:00"),
});
assert.equal(closed.state, "final");
assert.equal(closed.totalPay, 190);

const overtimeShift = calculateLivePay({
  date,
  clockIn: "01:00 PM",
  clockOut: "05:00 PM",
  hourlyRate: 20,
  weeklyHoursBeforeShift: 38,
});
assert.equal(overtimeShift.regularHours, 2);
assert.equal(overtimeShift.overtimeHours, 2);
assert.equal(overtimeShift.regularPay, 40);
assert.equal(overtimeShift.overtimePay, 60);
assert.equal(overtimeShift.overtimePremium, 20);
assert.equal(overtimeShift.hourlyLaborCost, 100);
assert.equal(overtimeShift.totalPay, 100);

const weeklyAllocation = calculateWeeklyOvertime([
  { hours: 35, hourlyRate: 20, straightTimePay: 700 },
  { hours: 10, hourlyRate: 20, straightTimePay: 200 },
]);
assert.equal(weeklyAllocation[1].regularHours, 5);
assert.equal(weeklyAllocation[1].overtimeHours, 5);
assert.equal(weeklyAllocation[1].overtimePremium, 50);
assert.equal(weeklyAllocation[1].hourlyLaborCost, 250);

const missingRate = calculateLivePay({ date, clockIn: "01:00 PM", now: chicagoNow });
assert.equal(missingRate.state, "missing_rate");
assert.equal(missingRate.totalPay, null);

const missingClock = calculateLivePay({ date, hourlyRate: 20, now: chicagoNow });
assert.equal(missingClock.state, "missing_clock");
assert.equal(missingClock.totalPay, null);

const salary = calculateLivePay({ date, isSalary: true, totalBonus: 25, now: chicagoNow });
assert.equal(salary.state, "salary");
assert.equal(salary.regularPay, null);
assert.equal(salary.totalPay, 25);

const bonusCrossing = calculateLivePay({
  date,
  clockIn: "01:00 PM",
  hourlyRate: 20,
  totalBonus: 200,
  now: chicagoNow,
});
assert.equal(Number(bonusCrossing.totalPay) - Number(open.totalPay), 50);

const lance = calculateLivePay({
  date,
  clockIn: "07:18 AM",
  clockOut: "05:20 PM",
  hourlyRate: 18.5,
  totalBonus: 0,
});
assert.equal(lance.workedSeconds, 36120);
assert.ok(Math.abs(Number(lance.workedHours) - 10.033333333333333) < 1e-12);
assert.ok(Math.abs(Number(lance.regularPay) - 185.61666666666667) < 1e-10);

const malformed = calculateLivePay({
  date,
  clockIn: "05:00 PM",
  clockOut: "08:00 AM",
  hourlyRate: 20,
});
assert.equal(malformed.state, "invalid_shift");

const implausible = calculateLivePay({
  date,
  clockIn: "12:00 AM",
  clockOut: "11:59 PM",
  hourlyRate: 20,
});
assert.equal(implausible.state, "invalid_shift");

const beforeRefresh = calculateLivePay({
  date,
  clockIn: "01:00 PM",
  hourlyRate: 20,
  now: new Date("2026-07-13T17:19:00-05:00"),
});
const afterRefresh = calculateLivePay({
  date,
  clockIn: "01:00 PM",
  clockOut: "05:20 PM",
  hourlyRate: 20,
  now: new Date("2026-07-13T17:30:00-05:00"),
});
assert.equal(beforeRefresh.state, "open");
assert.equal(afterRefresh.state, "final");
assert.equal(afterRefresh.workedSeconds, 15600);

const periodTotal = Number(openLater.totalPay) + Number(lance.totalPay);
assert.ok(periodTotal > Number(open.totalPay) + Number(lance.totalPay));

console.log("live pay validation passed");
