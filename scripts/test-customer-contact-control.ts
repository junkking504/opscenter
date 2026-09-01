import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DispatchControlSnapshot } from "@/lib/dispatch-control";

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-customer-contact-"));
  const date = "2026-09-01";
  process.env.OPSBOT_DATA_DIR = temporary;
  process.env.CUSTOMER_CONTACT_STORE = path.join(temporary, "communications", "customer-contact.json");
  process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";

  const {
    buildCustomerContactSnapshot,
    executeCustomerContactOutcome,
    executeCustomerContactPlan,
    verifyCustomerContactOutcome,
    verifyCustomerContactPlan,
  } = await import("@/lib/customer-contact-control");
  const { readCustomerContactStore } = await import("@/lib/customer-contact-store");
  const { validateCustomerContactOutcome, validateCustomerContactPlan } = await import("@/lib/platform/actions/customer-contact");

  const observationKey = "a".repeat(64);
  const appointment = {
    appointmentId: "4057001",
    jobKey: "appt:4057001",
    jkNumber: "JK4070001",
    customerName: "Test Customer",
    phone: "(504) 555-0199",
    appointmentTime: "10:00 AM - 11:00 AM",
    appointmentStartMinutes: 600,
    appointmentEndMinutes: 660,
    appointmentType: "Job",
    status: "Confirmed",
    territory: "New Orleans",
    sourceTruck: "Truck 4",
    effectiveTruck: "Truck 4",
    sourceObservedAt: "2026-09-01T14:00:00.000Z",
    routeUpdatedAt: "",
    callAheadStatus: "" as const,
    contactObservationKey: observationKey,
  };
  let dispatch: DispatchControlSnapshot = {
    date,
    mode: "preview_simulation",
    source: "JunkWare verified schedule",
    sourceObservedAt: appointment.sourceObservedAt,
    appointments: [appointment],
    trucks: ["Truck 4"],
  };
  const snapshotReader = (requestedDate: string) => buildCustomerContactSnapshot(requestedDate, dispatch, readCustomerContactStore());

  try {
    const initial = snapshotReader(date);
    assert.equal(initial.appointments.length, 1);
    assert.equal(initial.appointments[0].maskedPhone, "(***) ***-0199");
    assert.match(initial.authorityNotice, /OpsBot does not send/);
    assert.match(initial.authorityNotice, /carrier delivery remains unverified/);

    const planInput = validateCustomerContactPlan({
      date,
      appointmentId: appointment.appointmentId,
      jobKey: appointment.jobKey,
      channel: "sms",
      purpose: "Confirm the arrival window",
      message: "Junk King plans to arrive during your scheduled window. Reply to the human operator if anything changed.",
      owner: "Dispatch lead",
      nextAction: "Open the approved text draft and confirm the outcome.",
      sourceObservedAt: appointment.sourceObservedAt,
      expectedObservationKey: observationKey,
      expectedStoreUpdatedAt: initial.storeUpdatedAt,
    });
    assert.throws(() => validateCustomerContactPlan({ ...planInput, message: "Call 504-555-0199 before arrival." }), /cannot contain contact details/);

    const previewPlan = await executeCustomerContactPlan(planInput, "Requesting manager", "action_preview-plan", snapshotReader);
    assert.equal(previewPlan.mode, "preview_simulation");
    assert.equal(previewPlan.changed, false);
    assert.equal(verifyCustomerContactPlan(previewPlan, planInput).outcome, "verified");
    assert.equal(fs.existsSync(process.env.CUSTOMER_CONTACT_STORE), false, "Preview approval simulation must not persist a plan.");

    process.env.OPSCENTER_RUNTIME = "MISSION_CONTROL";
    const savedPlan = await executeCustomerContactPlan(planInput, "Requesting manager", "action_live-plan", snapshotReader);
    assert.equal(savedPlan.mode, "live_control");
    assert.equal(savedPlan.changed, true);
    assert.equal(verifyCustomerContactPlan(savedPlan, planInput).outcome, "verified");

    const rawStore = fs.readFileSync(process.env.CUSTOMER_CONTACT_STORE, "utf8");
    assert.doesNotMatch(rawStore, /504|555|0199|Test Customer/, "The governed contact ledger must not store the customer name or phone.");
    const approved = snapshotReader(date);
    const approvedAppointment = approved.appointments[0];
    const approvedRecord = approvedAppointment.latestPlan;
    assert.ok(approvedRecord);
    assert.equal(approvedRecord.status, "approved");
    assert.equal(approvedAppointment.planCurrent, true);

    dispatch = {
      ...dispatch,
      sourceObservedAt: "2026-09-01T14:01:00.000Z",
      appointments: [{ ...appointment, sourceObservedAt: "2026-09-01T14:01:00.000Z" }],
    };
    assert.equal(snapshotReader(date).appointments[0].planCurrent, true, "An unchanged appointment must remain current after a fresh source scrape.");

    dispatch = { ...dispatch, appointments: [{ ...dispatch.appointments[0], contactObservationKey: "b".repeat(64) }] };
    await assert.rejects(
      () => executeCustomerContactPlan({ ...planInput, expectedStoreUpdatedAt: approved.storeUpdatedAt }, "Requesting manager", "action_stale-plan", snapshotReader),
      /VERSION_CONFLICT/,
      "A changed phone, time, or status observation must invalidate a prepared approval.",
    );
    dispatch = { ...dispatch, appointments: [{ ...dispatch.appointments[0], contactObservationKey: observationKey }] };

    const current = snapshotReader(date);
    const currentPlan = current.appointments[0].latestPlan!;
    const outcomeInput = validateCustomerContactOutcome({
      date,
      appointmentId: appointment.appointmentId,
      jobKey: appointment.jobKey,
      recordId: currentPlan.recordId,
      outcome: "sms_sent",
      evidenceNote: "The human operator confirmed that the SMS composer was sent.",
      sourceObservedAt: current.appointments[0].sourceObservedAt,
      expectedObservationKey: current.appointments[0].observationKey,
      expectedStoreUpdatedAt: current.storeUpdatedAt,
      expectedRecordUpdatedAt: currentPlan.updatedAt,
    });
    assert.throws(() => validateCustomerContactOutcome({ ...outcomeInput, evidenceNote: "Customer emailed test@example.com." }), /cannot contain contact details/);

    process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";
    let previewNoteCalled = false;
    const previewOutcome = await executeCustomerContactOutcome(outcomeInput, "Human operator", snapshotReader, async () => {
      previewNoteCalled = true;
      throw new Error("Preview must not write a JunkWare note.");
    });
    assert.equal(previewOutcome.mode, "preview_simulation");
    assert.equal(previewNoteCalled, false);
    assert.equal(verifyCustomerContactOutcome(previewOutcome, outcomeInput).outcome, "verified");

    process.env.OPSCENTER_RUNTIME = "MISSION_CONTROL";
    let writtenNote = "";
    const liveOutcome = await executeCustomerContactOutcome(outcomeInput, "Human operator", snapshotReader, async (input) => {
      writtenNote = input.note;
      return { appointmentId: input.appointmentId, note: input.note, verifiedAt: "2026-09-01T14:05:00.000Z" };
    });
    assert.equal(liveOutcome.mode, "live_control");
    assert.equal(liveOutcome.changed, true);
    assert.match(writtenNote, /^\[OpsBot Contact\] SMS outcome: sms sent\./);
    assert.doesNotMatch(writtenNote, /504|555|0199|scheduled window|Test Customer/);
    assert.equal(verifyCustomerContactOutcome(liveOutcome, outcomeInput).outcome, "verified");
    const completed = snapshotReader(date).appointments[0].latestPlan!;
    assert.equal(completed.status, "outcome_recorded");
    assert.equal(completed.outcome, "sms_sent");
    assert.equal(completed.junkwareVerifiedAt, "2026-09-01T14:05:00.000Z");
    assert.equal(snapshotReader(date).summary.outcomesRecorded, 1);

    await assert.rejects(
      () => executeCustomerContactOutcome(outcomeInput, "Human operator", snapshotReader, async () => {
        throw new Error("A stale outcome must fail before JunkWare is called.");
      }),
      /VERSION_CONFLICT|already has/,
      "A recorded outcome must not be duplicated through a stale request.",
    );

    console.log("Customer contact approval, privacy, exact-source conflicts, human compose boundary, JunkWare note verification, and preview isolation passed.");
  } finally {
    delete process.env.OPSBOT_DATA_DIR;
    delete process.env.CUSTOMER_CONTACT_STORE;
    delete process.env.OPSCENTER_RUNTIME;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
