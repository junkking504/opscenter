import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-payroll-corrections-"));
process.env.OPSBOT_DATA_DIR = testRoot;

async function main() {
  const {
    deletePayrollCorrection,
    payrollCorrectionForEmployee,
    readPayrollCorrectionStore,
    upsertPayrollCorrection,
  } = await import("../lib/payroll-corrections");

  const created = upsertPayrollCorrection({
    employeeName: "Devin Harris",
    workDate: "2026-08-26",
    clockIn: "07:30 AM",
    clockOut: "",
    hourlyRate: 16,
    note: "Missing JunkWare punch confirmed.",
    updatedBy: "owner@example.com",
  });
  assert.ok(created);
  assert.equal(created.clockIn, "07:30 AM");
  assert.equal(created.hourlyRate, 16);

  const readBack = payrollCorrectionForEmployee("2026-08-26", "Harris, Devin");
  assert.equal(readBack?.correctionId, created.correctionId);

  const updated = upsertPayrollCorrection({
    employeeName: "Devin Harris",
    workDate: "2026-08-26",
    clockIn: "07:30 AM",
    clockOut: "04:15 PM",
    hourlyRate: 16.5,
    note: "Final punch confirmed.",
    updatedBy: "owner@example.com",
  });
  assert.equal(updated?.correctionId, created.correctionId);
  assert.equal(updated?.clockOut, "04:15 PM");
  assert.equal(updated?.hourlyRate, 16.5);
  assert.equal(readPayrollCorrectionStore().audit.length, 2);

  assert.equal(deletePayrollCorrection("2026-08-26", "Devin Harris", "owner@example.com"), true);
  assert.equal(payrollCorrectionForEmployee("2026-08-26", "Devin Harris"), null);
  const finalStore = readPayrollCorrectionStore();
  assert.equal(finalStore.audit.length, 3);
  assert.equal(finalStore.audit.at(-1)?.action, "removed");

  assert.equal(upsertPayrollCorrection({
    employeeName: "Devin Harris",
    workDate: "2026-08-26",
    clockIn: "",
    hourlyRate: 16,
    note: "Invalid without clock-in.",
  }), null);

  console.log("payroll correction tests passed");
}

main()
  .finally(() => fs.rmSync(testRoot, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
