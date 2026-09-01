import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  executeFinanceManualBonus,
  executeFinancePaymentExceptionReview,
  executeFinancePayrollCorrection,
  readFinanceControlSnapshot,
  verifyFinanceManualBonus,
  verifyFinancePaymentExceptionReview,
  verifyFinancePayrollCorrection,
} from "@/lib/finance-control";
import type { PaymentReconciliationView } from "@/lib/payment-reconciliation";
import { readPaymentExceptionReviewStore } from "@/lib/payment-exception-reviews";
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
  const paymentReviewFile = path.join(temporaryDirectory, "finance", "payment_exception_reviews.json");
  process.env.MANUAL_BONUSES_FILE = manualBonusFile;
  process.env.PAYMENT_EXCEPTION_REVIEW_FILE = paymentReviewFile;
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

    const reconciliationView = (generatedAt = "2099-08-31T18:00:00.000Z"): PaymentReconciliationView => ({
      status: "needs_review",
      summary: {
        junkware_count: 1,
        junkware_total: 425,
        merchant_center_count: 0,
        merchant_center_total: 0,
        matched_count: 0,
        matched_total: 0,
        tip_total: 0,
        missing_in_merchant_center_count: 1,
        merchant_center_only_count: 0,
        ambiguous_count: 0,
        amount_mismatch_count: 0,
        exception_count: 1,
        net_difference: -425,
        processing_fees: 0,
      },
      exceptions: [{
        date: "2099-08-31",
        type: "Missing in QBO",
        reference: "JK9001001",
        customer: "Example Customer",
        cardLastFour: "4242",
        junkwareAmount: 425,
        merchantAmount: null,
      }],
      paymentsByJob: [],
      generatedAt,
      merchantCenterAvailable: true,
      merchantCenterFresh: true,
      merchantCenterCollectedAt: "2099-08-31T17:59:00.000Z",
      merchantSourceName: "QuickBooks Online API — Example Company",
      merchantCollector: "qbo-accounting-api",
      coverage: { collectedDays: 1, expectedDays: 1, merchantDays: 1 },
    });
    const reconciliationReader = () => reconciliationView();
    const exceptionSnapshot = readFinanceControlSnapshot("2099-08-31", reconciliationReader);
    assert.equal(exceptionSnapshot.paymentReconciliation.exceptionCount, 1);
    assert.equal(exceptionSnapshot.paymentReconciliation.currentReviewCount, 0);
    const paymentException = exceptionSnapshot.paymentReconciliation.exceptions[0];
    assert.match(paymentException.exceptionId, /^payment_exception_[0-9a-f]{24}$/);
    assert.equal(paymentException.suggestedDisposition, "qbo_follow_up");
    const paymentReviewInput = {
      date: "2099-08-31",
      exceptionId: paymentException.exceptionId,
      disposition: "qbo_follow_up" as const,
      owner: "Finance lead",
      nextAction: "Verify the payment in QBO and refresh reconciliation.",
      note: "JunkWare payment evidence is present and the QBO match is missing.",
      expectedReviewStoreUpdatedAt: exceptionSnapshot.paymentReconciliation.reviewStoreUpdatedAt,
      expectedReviewUpdatedAt: "",
      expectedObservationKey: paymentException.observationKey,
    };
    const paymentReviewReceipt = await executeFinancePaymentExceptionReview(
      paymentReviewInput,
      "Approving finance manager",
      reconciliationReader,
    );
    assert.equal(paymentReviewReceipt.mode, "live_control");
    assert.equal((await verifyFinancePaymentExceptionReview(paymentReviewReceipt, paymentReviewInput)).outcome, "verified");
    assert.equal(readPaymentExceptionReviewStore().audit.length, 1);
    const reviewedExceptionSnapshot = readFinanceControlSnapshot("2099-08-31", reconciliationReader);
    assert.equal(reviewedExceptionSnapshot.paymentReconciliation.currentReviewCount, 1);
    assert.equal(reviewedExceptionSnapshot.paymentReconciliation.exceptions[0].reviewCurrent, true);

    const changedReconciliationReader = () => reconciliationView("2099-08-31T18:05:00.000Z");
    const changedExceptionSnapshot = readFinanceControlSnapshot("2099-08-31", changedReconciliationReader);
    assert.equal(changedExceptionSnapshot.paymentReconciliation.currentReviewCount, 0);
    assert.equal(changedExceptionSnapshot.paymentReconciliation.exceptions[0].reviewCurrent, false);
    await assert.rejects(executeFinancePaymentExceptionReview({
      ...paymentReviewInput,
      expectedReviewStoreUpdatedAt: reviewedExceptionSnapshot.paymentReconciliation.reviewStoreUpdatedAt,
      expectedReviewUpdatedAt: reviewedExceptionSnapshot.paymentReconciliation.exceptions[0].review?.updatedAt || "",
    }, "Approving finance manager", changedReconciliationReader), /reconciliation evidence changed/);

    process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";
    const bonusHash = digest(manualBonusFile);
    const payrollHash = digest(payrollFile);
    const paymentReviewHash = digest(paymentReviewFile);
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
    const previewException = changedExceptionSnapshot.paymentReconciliation.exceptions[0];
    const previewPaymentReviewInput = {
      ...paymentReviewInput,
      disposition: "keep_open" as const,
      nextAction: "Keep the exception open until refreshed QBO evidence is available.",
      note: "Preview verifies governed follow-up without clearing the source exception.",
      expectedReviewStoreUpdatedAt: changedExceptionSnapshot.paymentReconciliation.reviewStoreUpdatedAt,
      expectedReviewUpdatedAt: previewException.review?.updatedAt || "",
      expectedObservationKey: previewException.observationKey,
    };
    const previewPaymentReviewReceipt = await executeFinancePaymentExceptionReview(
      previewPaymentReviewInput,
      "Preview finance manager",
      changedReconciliationReader,
    );
    assert.equal(previewPaymentReviewReceipt.mode, "preview_simulation");
    assert.equal((await verifyFinancePaymentExceptionReview(previewPaymentReviewReceipt, previewPaymentReviewInput)).outcome, "verified");
    assert.equal(digest(paymentReviewFile), paymentReviewHash);

    console.log("Finance snapshot, source guards, verified writes, stale-state rejection, and preview-isolation checks passed.");
  } finally {
    delete process.env.MANUAL_BONUSES_FILE;
    delete process.env.PAYMENT_EXCEPTION_REVIEW_FILE;
    delete process.env.OPSBOT_DATA_DIR;
    delete process.env.OPSCENTER_RUNTIME;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
