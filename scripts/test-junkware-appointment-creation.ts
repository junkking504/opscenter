import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function tomorrow(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 2);
  return date.toISOString().slice(0, 10);
}

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-appointment-create-"));
  const creationDirectory = path.join(temporaryDirectory, "creations");
  const opsbotDirectory = path.join(temporaryDirectory, "opsbot");
  process.env.JUNKWARE_APPOINTMENT_CREATION_DIR = creationDirectory;
  process.env.OPSBOT_DATA_DIR = opsbotDirectory;
  process.env.JUNKWARE_APPOINTMENT_CREATION_STUB = "1";
  process.env.JUNKWARE_APPOINTMENT_CREATION_STUB_JK = "JK4999123";

  const {
    createJunkwareAppointment,
    normalizeJunkwareAppointmentCreationInput,
  } = await import("@/lib/junkware-appointment-creation");

  const input = {
    requestId: randomUUID(),
    franchise: "New Orleans",
    date: tomorrow(),
    startTime: "09:00",
    durationHours: 1,
    truck: "Truck 2",
    appointmentType: "Estimate",
    firstName: "Test",
    lastName: "Customer",
    business: false,
    company: "",
    phone: "(504) 555-0199",
    email: "test@example.com",
    billingAddress: "100 Test Street",
    billingZip: "70119",
    billingEmail: "",
    howHeard: "Referral",
    serviceAddress: "100 Test Street",
    serviceZip: "70119",
    serviceContactName: "",
    serviceContactPhone: "",
    estimatedPickups: 1.5,
    scope: "On-site estimate",
    notes: "Call before arrival.",
    duplicateOverrideReason: "",
  };

  const normalized = normalizeJunkwareAppointmentCreationInput(input);
  assert.equal(normalized.phone, "5045550199");
  assert.equal(normalized.appointmentType, "Estimate");
  assert.equal(normalized.estimatedPickups, 1.5);
  assert.throws(
    () => normalizeJunkwareAppointmentCreationInput({ ...input, appointmentType: "Service" }),
    /Job or Estimate/,
  );
  assert.throws(
    () => normalizeJunkwareAppointmentCreationInput({ ...input, date: "2020-01-01" }),
    /today or a future/,
  );
  assert.throws(
    () => normalizeJunkwareAppointmentCreationInput({ ...input, phone: "555" }),
    /10-digit/,
  );

  const created = await createJunkwareAppointment(input);
  assert.equal(created.replayed, false);
  assert.equal(created.result.jkNumber, "JK4999123");
  assert.equal(created.result.appointmentType, "Estimate");
  assert.equal(created.result.customerMode, "new");

  const replayed = await createJunkwareAppointment(input);
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.result, created.result);
  await assert.rejects(
    () => createJunkwareAppointment({ ...input, truck: "Truck 3" }),
    /changed after it was submitted/,
  );

  const recordSource = fs.readFileSync(path.join(creationDirectory, `${input.requestId}.json`), "utf8");
  assert.doesNotMatch(recordSource, /Test Customer|5045550199|100 Test Street/);
  assert.match(recordSource, /"status": "verified"/);

  const historyDirectory = path.join(opsbotDirectory, "history", "junkware");
  fs.mkdirSync(historyDirectory, { recursive: true });
  fs.writeFileSync(path.join(historyDirectory, `junkware_${input.date}_raw.json`), JSON.stringify({
    appointments: [{
      appt_id: "4100000",
      job_id: "JK4113178",
      job_status: "Confirmed",
      phone: "504-555-0199",
      address: "100 Test Street",
      appointment_time: "9:00 AM",
    }],
  }));

  const replayedAfterSourceRefresh = await createJunkwareAppointment(input);
  assert.equal(replayedAfterSourceRefresh.replayed, true);
  assert.equal(replayedAfterSourceRefresh.result.jkNumber, "JK4999123");

  await assert.rejects(
    () => createJunkwareAppointment({ ...input, requestId: randomUUID() }),
    /already matches this phone, service address, date, and start time/,
  );
  const override = await createJunkwareAppointment({
    ...input,
    requestId: randomUUID(),
    duplicateOverrideReason: "Customer requested a separate second pickup.",
  });
  assert.equal(override.result.jkNumber, "JK4999123");

  fs.rmSync(path.join(historyDirectory, `junkware_${input.date}_raw.json`), { force: true });
  const retryableInput = { ...input, requestId: randomUUID(), phone: "5045550188" };
  process.env.JUNKWARE_APPOINTMENT_CREATION_STUB_FAILURE_STAGE = "preflight";
  await assert.rejects(() => createJunkwareAppointment(retryableInput), /Stubbed JunkWare/);
  delete process.env.JUNKWARE_APPOINTMENT_CREATION_STUB_FAILURE_STAGE;
  assert.equal((await createJunkwareAppointment(retryableInput)).result.jkNumber, "JK4999123");

  const uncertainInput = { ...input, requestId: randomUUID(), phone: "5045550177" };
  process.env.JUNKWARE_APPOINTMENT_CREATION_STUB_FAILURE_STAGE = "verifying";
  await assert.rejects(() => createJunkwareAppointment(uncertainInput), /Stubbed JunkWare/);
  delete process.env.JUNKWARE_APPOINTMENT_CREATION_STUB_FAILURE_STAGE;
  await assert.rejects(() => createJunkwareAppointment(uncertainInput), /Search JunkWare before creating another appointment/);

  const adapter = fs.readFileSync(new URL("./create-junkware-appointment.ts", import.meta.url), "utf8");
  assert.match(adapter, /ctl00_Content_SaveAppointmentBtn/);
  assert.match(adapter, /stage = "saving"/);
  assert.match(adapter, /stage = "verifying"/);
  assert.match(adapter, /The JunkWare read-back did not match the reviewed appointment/);
  assert.match(adapter, /ctl00_Content_AppointmentTypeDD/);
  assert.match(adapter, /ctl00_Content_AvailableTimesDD/);
  assert.match(adapter, /ctl00_Content_TruckDD/);

  const component = fs.readFileSync(new URL("../components/AppointmentCreateDialog.tsx", import.meta.url), "utf8");
  assert.match(component, /The JK number appears only after JunkWare saves and OpsCenter reads the appointment back/);
  assert.match(component, /JunkWare-Governed Booking/);
  assert.match(component, /<option value="" disabled>Select source<\/option>/);
  assert.match(component, /Possible Duplicate Blocked/);
  assert.match(component, /Do Not Retry Yet/);

  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  console.log("JunkWare appointment creation verification passed.");
}

void main();
