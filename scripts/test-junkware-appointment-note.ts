import assert from "node:assert/strict";

async function main() {
  const { addJunkwareAppointmentNote, validJunkwareAppointmentNote } = await import("@/lib/junkware-appointment-note");
  assert.equal(validJunkwareAppointmentNote("  Call before arrival.  "), "Call before arrival.");
  assert.throws(() => validJunkwareAppointmentNote(""), /Enter a note/);
  assert.throws(() => validJunkwareAppointmentNote("x".repeat(501)), /500 characters/);
  process.env.JUNKWARE_APPOINTMENT_NOTE_STUB = "1";
  const result = await addJunkwareAppointmentNote({ appointmentId: "1234567", note: "Gate code is 1234." });
  assert.equal(result.appointmentId, "1234567");
  assert.equal(result.note, "Gate code is 1234.");
  await assert.rejects(() => addJunkwareAppointmentNote({ appointmentId: "invalid", note: "A note" }), /appointment ID/);
  console.log("JunkWare appointment note verification passed.");
}

void main();
