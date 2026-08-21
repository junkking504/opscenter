import assert from "node:assert/strict";

async function main() {
  process.env.JUNKWARE_APPOINTMENT_RESCHEDULE_STUB = "1";
  const { rescheduleJunkwareAppointment } = await import("@/lib/junkware-appointment-reschedule");
  await assert.rejects(() => rescheduleJunkwareAppointment({ appointmentId: "invalid", date: "2026-08-25", appointmentStartMinutes: 600 }), /appointment ID/i);
  await assert.rejects(() => rescheduleJunkwareAppointment({ appointmentId: "4038882", date: "08/25/2026", appointmentStartMinutes: 600 }), /date/i);
  await assert.rejects(() => rescheduleJunkwareAppointment({ appointmentId: "4038882", date: "2026-08-25", appointmentStartMinutes: 615 }), /hourly/i);
  const result = await rescheduleJunkwareAppointment({ appointmentId: "4038882", date: "2026-08-25", appointmentStartMinutes: 10 * 60 });
  assert.equal(result.appointmentId, "4038882");
  assert.equal(result.date, "2026-08-25");
  assert.equal(result.appointmentStartMinutes, 10 * 60);
  assert.equal(result.changed, true);
  console.log("Job reschedule verification passed.");
}

void main();
