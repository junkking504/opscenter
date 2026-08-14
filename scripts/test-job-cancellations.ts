import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-job-cancellations-"));
  process.env.JOB_CANCELLATIONS_FILE = path.join(temporaryDirectory, "cancellations.json");
  process.env.JUNKWARE_APPOINTMENT_CANCELLATION_STUB = "1";

  try {
    const { readVerifiedJobCancellations, saveVerifiedJobCancellation } = await import("@/lib/job-cancellations");
    const { cancelJunkwareAppointment } = await import("@/lib/junkware-appointment-cancellation");

    await assert.rejects(
      () => cancelJunkwareAppointment("4038882", ""),
      /reason is required/i,
    );
    const junkware = await cancelJunkwareAppointment("4038882", "Customer requested cancellation");
    assert.equal(junkware.status, "Canceled");
    assert.equal(junkware.changed, true);

    const saved = saveVerifiedJobCancellation({
      date: "2026-08-14",
      appointmentId: "4038882",
      jobKey: "appt:4038882",
      jkNumber: "JK4052060",
      customerName: "Test Customer",
      cancellationReason: "Customer requested cancellation",
      canceledAt: "2026-08-14T15:00:00.000Z",
      junkwareVerifiedAt: junkware.verifiedAt,
    });
    assert.equal(saved.jobKey, "appt:4038882");
    assert.equal(saved.cancellationReason, "Customer requested cancellation");
    assert.equal(readVerifiedJobCancellations("2026-08-14").length, 1);

    saveVerifiedJobCancellation({ ...saved, customerName: "Updated Customer" });
    const entries = readVerifiedJobCancellations();
    assert.equal(entries.length, 1, "Saving the same appointment must be idempotent.");
    assert.equal(entries[0].customerName, "Updated Customer");
    assert.throws(
      () => saveVerifiedJobCancellation({ ...saved, appointmentId: "invalid" }),
      /could not be recorded/i,
    );

    console.log("Job cancellation verification passed.");
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

void main();
