import assert from "node:assert/strict";
import fs, { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-job-reschedules-"));
  process.env.JOB_RESCHEDULES_FILE = path.join(temporary, "reschedules.json");
  process.env.JUNKWARE_APPOINTMENT_RESCHEDULE_STUB = "1";
  const { rescheduleJunkwareAppointment } = await import("@/lib/junkware-appointment-reschedule");
  const { readVerifiedJobReschedules, saveVerifiedJobReschedule } = await import("@/lib/job-reschedules");
  const base = {
    appointmentId: "4038882",
    date: "2026-09-01",
    appointmentStartMinutes: 10 * 60,
    expectedDate: "2026-08-31",
    expectedAppointmentStartMinutes: 9 * 60,
  };
  await assert.rejects(() => rescheduleJunkwareAppointment({ ...base, appointmentId: "invalid" }), /appointment ID/i);
  await assert.rejects(() => rescheduleJunkwareAppointment({ ...base, date: "09/01/2026" }), /date/i);
  await assert.rejects(() => rescheduleJunkwareAppointment({ ...base, appointmentStartMinutes: 615 }), /hourly/i);
  const result = await rescheduleJunkwareAppointment(base);
  assert.equal(result.previousDate, "2026-08-31");
  assert.equal(result.previousAppointmentStartMinutes, 9 * 60);
  assert.equal(result.date, "2026-09-01");
  assert.equal(result.appointmentStartMinutes, 10 * 60);
  assert.equal(result.changed, true);
  const saved = saveVerifiedJobReschedule({
    appointmentId: result.appointmentId,
    jobKey: `appt:${result.appointmentId}`,
    sourceDate: result.previousDate,
    destinationDate: result.date,
    previousAppointmentStartMinutes: result.previousAppointmentStartMinutes,
    appointmentStartMinutes: result.appointmentStartMinutes,
    movedAt: "2026-08-31T20:00:00.000Z",
    junkwareVerifiedAt: result.verifiedAt,
  });
  assert.equal(saved.destinationDate, "2026-09-01");
  assert.equal(readVerifiedJobReschedules("2026-08-31").length, 1);
  const script = readFileSync(path.join(process.cwd(), "scripts", "reschedule-junkware-appointment.ts"), "utf8");
  const conflictCheck = script.indexOf("previousDate !== expectedDate");
  const firstDateWrite = script.indexOf("await dateField.fill");
  assert.ok(conflictCheck >= 0 && firstDateWrite > conflictCheck, "The adapter must reject stale date/time state before touching the JunkWare form.");
  fs.rmSync(temporary, { recursive: true, force: true });
  console.log("JunkWare cross-date reschedule verification passed.");
}

void main();
