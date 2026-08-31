import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  executeFinanceManualBonus,
  executeFinancePayrollCorrection,
  readFinanceControlSnapshot,
  verifyFinanceManualBonus,
  verifyFinancePayrollCorrection,
} from "@/lib/finance-control";
import {
  readManualBonusStore,
  upsertManualBonusEntry,
} from "@/lib/manual-bonuses";
import {
  readPayrollCorrectionStore,
  upsertPayrollCorrection,
} from "@/lib/payroll-corrections";

function digest(file: string): string {
  return fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "missing";
}

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-finance-control-"));
  const manualBonusFile = path.join(temporaryDirectory, "manual_bonus_entries.json");
  const payrollFile = path.join(temporaryDirectory, "payroll_corrections", "payroll_corrections.json");
  process.env.MANUAL_BONUSES_FILE = manualBonusFile;
  process.env.OPSBOT_DATA_DIR = temporaryDirectory;

  try {
    process.env.OPSCENTER_RUNTIME = "MISSION_CONTROL";
    const seedBonus = upsertManualBonusEntry({
      employeeName: "Alex Rivera",
      workDate: "2099-08-31",
      amount: 25,
      note: "Customer compliment",
    });
    const seedCorrection = upsertPayrollCorrection({
      employeeName: "Morgan Lee",
      workDate: "2099-08-31",
      clockIn: "08:00 AM",
      clockOut: "04:30 PM",
      hourlyRate: 22,
      note: "Verified missed clock event",
      updatedBy: "Finance test",
    });
    assert.ok(seedBonus && seedCorrection);

    const initialSnapshot = readFinanceControlSnapshot("2099-08-31");
    assert.equal(initialSnapshot.mode, "live_control");
    assert.equal(initialSnapshot.paymentReconciliation.status, "not_collected");
    assert.equal(initialSnapshot.manualBonuses.count, 1);
    assert.equal(initialSnapshot.manualBonuses.totalAmount, 25);
    assert.equal(initialSnapshot.payrollCorrections.count, 1);
    assert.deepEqual(initialSnapshot.employees.map((employee) => employee.name), ["Alex Rivera", "Morgan Lee"]);

    const bonusReceipt = await executeFinanceManualBonus({
      employeeName: "Morgan Lee",
      workDate: "2099-08-31",
      amount: 40.5,
      note: "Approved safety leadership bonus",
      expectedBonusStoreUpdatedAt: initialSnapshot.manualBonuses.storeUpdatedAt,
    });
    assert.equal(bonusReceipt.mode, "live_control");
    assert.equal((await verifyFinanceManualBonus(bonusReceipt, {
      employeeName: "Morgan Lee",
      workDate: "2099-08-31",
      amount: 40.5,
      note: "Approved safety leadership bonus",
      expectedBonusStoreUpdatedAt: initialSnapshot.manualBonuses.storeUpdatedAt,
    })).outcome, "verified");
    assert.ok(readManualBonusStore().updatedAt > initialSnapshot.manualBonuses.storeUpdatedAt);
    await assert.rejects(executeFinanceManualBonus({
      employeeName: "Alex Rivera",
      workDate: "2099-08-31",
      amount: 10,
      note: "Stale bonus request",
      expectedBonusStoreUpdatedAt: initialSnapshot.manualBonuses.storeUpdatedAt,
    }), /VERSION_CONFLICT/);

    const payrollStoreBefore = readPayrollCorrectionStore();
    const payrollReceipt = await executeFinancePayrollCorrection({
      employeeName: "Alex Rivera",
      workDate: "2099-08-31",
      clockIn: "07:45 AM",
      clockOut: "04:15 PM",
      hourlyRate: 24.5,
      note: "Manager verified timecard evidence",
      expectedPayrollStoreUpdatedAt: payrollStoreBefore.updatedAt,
      expectedCorrectionUpdatedAt: "",
    }, "Approving manager");
    assert.equal((await verifyFinancePayrollCorrection(payrollReceipt, {
      employeeName: "Alex Rivera",
      workDate: "2099-08-31",
      clockIn: "07:45 AM",
      clockOut: "04:15 PM",
      hourlyRate: 24.5,
      note: "Manager verified timecard evidence",
      expectedPayrollStoreUpdatedAt: payrollStoreBefore.updatedAt,
      expectedCorrectionUpdatedAt: "",
    })).outcome, "verified");
    assert.ok(readPayrollCorrectionStore().updatedAt > payrollStoreBefore.updatedAt);
    await assert.rejects(executeFinancePayrollCorrection({
      employeeName: "Taylor Reed",
      workDate: "2099-08-31",
      clockIn: "08:15 AM",
      clockOut: "04:00 PM",
      hourlyRate: 20,
      note: "Stale correction request",
      expectedPayrollStoreUpdatedAt: payrollStoreBefore.updatedAt,
      expectedCorrectionUpdatedAt: "",
    }), /VERSION_CONFLICT/);

    process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";
    const bonusHash = digest(manualBonusFile);
    const payrollHash = digest(payrollFile);
    const previewBonusInput = {
      employeeName: "Taylor Reed",
      workDate: "2099-08-31",
      amount: 15,
      note: "Preview bonus simulation",
      expectedBonusStoreUpdatedAt: readManualBonusStore().updatedAt,
    };
    const previewBonusReceipt = await executeFinanceManualBonus(previewBonusInput);
    assert.equal(previewBonusReceipt.mode, "preview_simulation");
    assert.equal((await verifyFinanceManualBonus(previewBonusReceipt, previewBonusInput)).outcome, "verified");
    const previewPayrollInput = {
      employeeName: "Taylor Reed",
      workDate: "2099-08-31",
      clockIn: "08:15 AM",
      clockOut: "04:00 PM",
      hourlyRate: 20,
      note: "Preview payroll simulation",
      expectedPayrollStoreUpdatedAt: readPayrollCorrectionStore().updatedAt,
      expectedCorrectionUpdatedAt: "",
    };
    const previewPayrollReceipt = await executeFinancePayrollCorrection(previewPayrollInput);
    assert.equal(previewPayrollReceipt.mode, "preview_simulation");
    assert.equal((await verifyFinancePayrollCorrection(previewPayrollReceipt, previewPayrollInput)).outcome, "verified");
    assert.equal(digest(manualBonusFile), bonusHash);
    assert.equal(digest(payrollFile), payrollHash);

    console.log("Finance snapshot, source guards, verified writes, stale-state rejection, and preview-isolation checks passed.");
  } finally {
    delete process.env.MANUAL_BONUSES_FILE;
    delete process.env.OPSBOT_DATA_DIR;
    delete process.env.OPSCENTER_RUNTIME;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
