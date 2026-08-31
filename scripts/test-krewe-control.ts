import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  executeKreweAvailability,
  executeKreweScheduleCallIn,
  readKreweControlSnapshot,
  verifyKreweAvailability,
  verifyKreweScheduleCallIn,
} from "@/lib/krewe-control";
import { readKreweControlStore } from "@/lib/krewe-control-store";

function digest(file: string): string {
  return fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "missing";
}

function writeSchedule(file: string, scrapedAt: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    scraped_at: scrapedAt,
    appointments: [
      {
        appointment_time: "08:00 AM - 10:00 AM",
        territory: "New Orleans",
        driver: "Assigned Driver",
        navigator: "Assigned Navigator",
        additional_crew: [],
        status: "Confirmed",
      },
      {
        appointment_time: "08:00 AM - 10:00 AM",
        territory: "Northshore",
        driver: "",
        navigator: "",
        additional_crew: [],
        status: "Confirmed",
      },
    ],
    completed: [],
  }, null, 2));
}

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-krewe-control-"));
  const storeFile = path.join(temporaryDirectory, "crew_control", "availability.json");
  const scheduleFile = path.join(temporaryDirectory, "history", "junkware", "junkware_2099-09-01_raw.json");
  process.env.KREWE_CONTROL_FILE = storeFile;
  process.env.OPSBOT_DATA_DIR = temporaryDirectory;
  writeSchedule(scheduleFile, "2099-08-31T18:00:00.000Z");

  try {
    process.env.OPSCENTER_RUNTIME = "MISSION_CONTROL";
    const initial = readKreweControlSnapshot("2099-08-31");
    assert.equal(initial.mode, "live_control");
    assert.equal(initial.scheduleAvailable, true);
    assert.equal(initial.targetDate, "2099-09-01");
    assert.equal(initial.summary.tomorrowAppointments, 2);
    assert.equal(initial.summary.requiredHeadcount, 4);
    assert.equal(initial.summary.alreadyAssigned, 2);

    const availabilityInput = {
      employeeName: "Alex Rivera",
      targetDate: "2099-09-01",
      status: "available" as const,
      note: "Confirmed by phone",
      expectedStoreUpdatedAt: initial.storeUpdatedAt,
      expectedRecordUpdatedAt: "",
    };
    const availabilityReceipt = await executeKreweAvailability(availabilityInput, "Test operator");
    assert.equal(availabilityReceipt.mode, "live_control");
    assert.equal((await verifyKreweAvailability(availabilityReceipt, availabilityInput)).outcome, "verified");
    const availableStore = readKreweControlStore();
    assert.ok(availableStore.updatedAt > initial.storeUpdatedAt);
    assert.equal(availableStore.audit.at(-1)?.action, "availability_recorded");
    await assert.rejects(executeKreweAvailability({
      ...availabilityInput,
      employeeName: "Morgan Lee",
      note: "Stale response",
    }), /VERSION_CONFLICT/);

    const availableSnapshot = readKreweControlSnapshot("2099-08-31");
    assert.equal(availableSnapshot.summary.availableResponses, 1);
    assert.equal(availableSnapshot.people.find((person) => person.name === "Alex Rivera")?.availability?.status, "available");
    const callInInput = {
      employeeName: "Alex Rivera",
      baseDate: "2099-08-31",
      targetDate: "2099-09-01",
      role: "crew" as const,
      note: "Confirmed eight-hour Krewe call-in",
      availabilityConfirmed: true as const,
      expectedScheduleUpdatedAt: availableSnapshot.scheduleUpdatedAt,
      expectedStoreUpdatedAt: availableSnapshot.storeUpdatedAt,
      expectedRecordUpdatedAt: availableSnapshot.people.find((person) => person.name === "Alex Rivera")!.availability!.updatedAt,
    };
    const callInReceipt = await executeKreweScheduleCallIn(callInInput, "Approving manager");
    assert.equal((await verifyKreweScheduleCallIn(callInReceipt, callInInput)).outcome, "verified");
    assert.equal(readKreweControlStore().records[0].status, "called_in");
    assert.equal(readKreweControlStore().audit.at(-1)?.action, "call_in_scheduled");
    await assert.rejects(executeKreweAvailability({
      employeeName: "Alex Rivera",
      targetDate: "2099-09-01",
      status: "unavailable",
      note: "Attempt direct overwrite",
      expectedStoreUpdatedAt: readKreweControlStore().updatedAt,
      expectedRecordUpdatedAt: readKreweControlStore().records[0].updatedAt,
    }), /committed call-in/);

    const scheduleObservation = readKreweControlSnapshot("2099-08-31");
    writeSchedule(scheduleFile, "2099-08-31T18:05:00.000Z");
    await assert.rejects(executeKreweScheduleCallIn({
      employeeName: "Morgan Lee",
      baseDate: "2099-08-31",
      targetDate: "2099-09-01",
      role: "driver",
      note: "Stale schedule request",
      availabilityConfirmed: true,
      expectedScheduleUpdatedAt: scheduleObservation.scheduleUpdatedAt,
      expectedStoreUpdatedAt: scheduleObservation.storeUpdatedAt,
      expectedRecordUpdatedAt: "",
    }), /JunkWare schedule changed/);

    process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";
    const previewSnapshot = readKreweControlSnapshot("2099-08-31");
    const beforeHash = digest(storeFile);
    const previewAvailabilityInput = {
      employeeName: "Taylor Reed",
      targetDate: "2099-09-01",
      status: "available" as const,
      note: "Preview availability proof",
      expectedStoreUpdatedAt: previewSnapshot.storeUpdatedAt,
      expectedRecordUpdatedAt: "",
    };
    const previewAvailability = await executeKreweAvailability(previewAvailabilityInput);
    assert.equal(previewAvailability.mode, "preview_simulation");
    assert.equal((await verifyKreweAvailability(previewAvailability, previewAvailabilityInput)).outcome, "verified");
    const previewCallInInput = {
      employeeName: "Taylor Reed",
      baseDate: "2099-08-31",
      targetDate: "2099-09-01",
      role: "driver" as const,
      note: "Preview approved driver call-in",
      availabilityConfirmed: true as const,
      expectedScheduleUpdatedAt: previewSnapshot.scheduleUpdatedAt,
      expectedStoreUpdatedAt: previewSnapshot.storeUpdatedAt,
      expectedRecordUpdatedAt: "",
    };
    const previewCallIn = await executeKreweScheduleCallIn(previewCallInInput);
    assert.equal(previewCallIn.mode, "preview_simulation");
    assert.equal((await verifyKreweScheduleCallIn(previewCallIn, previewCallInInput)).outcome, "verified");
    assert.equal(digest(storeFile), beforeHash);

    console.log("Krewe snapshot, availability, call-in approval adapter, stale-state guards, audit, and preview-isolation checks passed.");
  } finally {
    delete process.env.KREWE_CONTROL_FILE;
    delete process.env.OPSBOT_DATA_DIR;
    delete process.env.OPSCENTER_RUNTIME;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
