import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPayrollCorrectionsToCrewMetrics } from "../lib/crew-portal-publication";
import { periodFromMetrics } from "../lib/crew-pay-portal";
import { upsertPayrollCorrection, type PayrollCorrection } from "../lib/payroll-corrections";
import { stagePayrollSync, writePayrollSync } from "../lib/junkware-payroll-sync";
import type { PayrollSync } from "../lib/junkware-payroll-sync";

const privateFields = ["correctionId", "note", "updatedBy", "updatedAt", "junkwareSync"];
const correction = (overrides: Partial<PayrollCorrection> = {}): PayrollCorrection => ({
  correctionId: "synthetic-correction-id",
  employeeName: "Synthetic Crew",
  normalizedEmployeeName: "synthetic crew",
  workDate: "2026-09-04",
  clockIn: "08:00 AM",
  clockOut: "06:00 PM",
  hourlyRate: 16,
  note: "Synthetic private reason",
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
  updatedBy: "manager@example.invalid",
  ...overrides,
});

const existing = {
  name: "Synthetic Crew",
  clock_in: "08:00 AM",
  clock_out: "",
  hours_worked: 0,
  hourly_rate: 16,
  hourly_pay: 0,
  tips: 5,
  total_bonus: 7,
  supplemental_daily_pay: 3,
  total_pay: 15,
  jobs_completed: 2,
  individual_revenue: 450,
  custom_performance_field: "preserved",
};
const other = { ...existing, name: "Other Synthetic Crew", individual_revenue: 300 };
const projected = applyPayrollCorrectionsToCrewMetrics(
  { payroll_records: [existing, other], employee_leaderboard: [existing, other] },
  "2026-09-04",
  { "synthetic crew": correction() },
  () => null,
);

for (const key of ["payroll_records", "employee_leaderboard"] as const) {
  const row = projected[key].find((candidate: Record<string, unknown>) => candidate.name === "Synthetic Crew");
  assert.equal(row.clock_out, "06:00 PM");
  assert.equal(row.hours_worked, 10);
  assert.equal(row.hourly_pay, 160);
  assert.equal(row.total_pay, 175);
  assert.equal(row.jobs_completed, 2);
  assert.equal(row.individual_revenue, 450);
  assert.equal(row.custom_performance_field, "preserved");
  assert.equal(row.pay_is_final, false);
  assert.equal(row.crew_pay_needs_review, true, "An unverified correction remains reviewable");
}
assert.deepEqual(projected.payroll_records[1], other, "Another employee's private row must not change");
assert.deepEqual(projected.employee_leaderboard[1], other, "Another employee's performance row must not change");
for (const field of privateFields) {
  assert.equal(JSON.stringify(projected).includes(field), false, `${field} must not enter the portal payload`);
}
assert.equal(JSON.stringify(projected).includes("Synthetic private reason"), false);
assert.equal(JSON.stringify(projected).includes("manager@example.invalid"), false);

const correctionOnly = applyPayrollCorrectionsToCrewMetrics(
  { employee_leaderboard: [other] },
  "2026-09-04",
  { "synthetic crew": correction() },
  () => null,
);
assert.equal(correctionOnly.payroll_records.length, 1, "A missed shift gets a private payroll row");
assert.equal(correctionOnly.payroll_records[0].name, "Synthetic Crew");
assert.equal(correctionOnly.payroll_records[0].hours_worked, 10);
assert.deepEqual(correctionOnly.employee_leaderboard, [other], "A missed shift does not join the shared performance roster");

const roundedCorrection = correction({
  clockIn: "08:07 AM",
  clockOut: "06:09 PM",
  hourlyRate: 17,
});
const verifiedSync: PayrollSync = {
  id: "a".repeat(64),
  correction: roundedCorrection,
  status: "verified",
  phase: "complete",
  message: "Synthetic source read-back",
  updatedAt: "2026-09-05T00:02:00.000Z",
  verifiedAt: "2026-09-05T00:02:00.000Z",
  after: {
    workDate: roundedCorrection.workDate,
    clockIn: roundedCorrection.clockIn,
    clockOut: roundedCorrection.clockOut,
    hourlyRate: roundedCorrection.hourlyRate,
    hours: 10.03,
    regularHours: 10.03,
    overtimeHours: 0,
    labor: 170.51,
  },
};
const verifiedProjection = applyPayrollCorrectionsToCrewMetrics(
  { payroll_records: [existing] },
  roundedCorrection.workDate,
  { "synthetic crew": roundedCorrection },
  () => verifiedSync,
);
assert.equal(verifiedProjection.payroll_records[0].hours_worked, 10.03, "Verified source-rounded hours beat raw clock arithmetic");
assert.equal(verifiedProjection.payroll_records[0].hourly_pay, 170.51, "Verified JunkWare labor crosses the handoff unchanged");
assert.equal(verifiedProjection.payroll_records[0].pay_is_final, true);
assert.equal(verifiedProjection.payroll_records[0].crew_pay_needs_review, false);
const staleVerifiedProjection = applyPayrollCorrectionsToCrewMetrics(
  { payroll_records: [existing] },
  roundedCorrection.workDate,
  { "synthetic crew": roundedCorrection },
  () => ({ ...verifiedSync, after: { ...verifiedSync.after!, clockOut: "05:00 PM" } }),
);
assert.equal(staleVerifiedProjection.payroll_records[0].pay_is_final, false, "A receipt for different clocks is not current verification");
assert.equal(staleVerifiedProjection.payroll_records[0].crew_pay_needs_review, true);

const metricsByDate = new Map<string, Record<string, any>>();
for (const date of ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03"]) {
  metricsByDate.set(date, {
    payroll_records: [{ ...existing, clock_out: "04:00 PM", hours_worked: 8, hourly_pay: 128, total_pay: 143 }],
  });
}
metricsByDate.set("2026-09-04", correctionOnly);
const period = periodFromMetrics("Synthetic Crew", "2026-08-31", metricsByDate, "2026-09-10");
const correctedDay = period.days.find((day) => day.date === "2026-09-04")!;
assert.equal(period.weeks[0].totals.hours, 42);
assert.equal(period.weeks[0].totals.regularHours, 40);
assert.equal(period.weeks[0].totals.overtimeHours, 2);
assert.equal(correctedDay.regularHours, 8);
assert.equal(correctedDay.overtimeHours, 2);
assert.equal(correctedDay.regularPay, 128);
assert.equal(correctedDay.overtimePay, 48);
assert.equal(correctedDay.totalPay, 176, "The correction-only shift receives weekly overtime pay");

const originalDataRoot = process.env.OPSBOT_DATA_DIR;
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "crew-portal-corrections-"));
try {
  process.env.OPSBOT_DATA_DIR = testRoot;
  const rejected = upsertPayrollCorrection({
    employeeName: "Rejected Synthetic Edit",
    workDate: "2026-09-04",
    clockIn: "08:00 AM",
    clockOut: "08:00 AM",
    hourlyRate: 16,
    note: "Synthetic rejected edit",
  })!;
  const sync = stagePayrollSync(rejected);
  writePayrollSync({ ...sync, status: "failed", phase: "reading", message: "Rejected before submission" });
  const source = { name: rejected.employeeName, clock_in: "08:00 AM", clock_out: "04:00 PM", hours_worked: 8, hourly_rate: 16 };
  const filtered = applyPayrollCorrectionsToCrewMetrics({ payroll_records: [source] }, rejected.workDate);
  assert.deepEqual(filtered.payroll_records, [source], "A failed pre-submission edit cannot override source payroll");
} finally {
  if (originalDataRoot === undefined) delete process.env.OPSBOT_DATA_DIR;
  else process.env.OPSBOT_DATA_DIR = originalDataRoot;
  fs.rmSync(testRoot, { recursive: true, force: true });
}

console.log("Crew Portal correction handoff passed: stale rows, missed shifts, privacy, applied-only filtering, and weekly overtime pay.");
