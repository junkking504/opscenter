import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-job-crew-notes-"));
  process.env.JOB_CREW_NOTES_FILE = path.join(directory, "notes.json");
  try {
    const { crewJobNotesFromAppointments, readJobCrewNotes, removeJobCrewNote, saveJobCrewNote } = await import("@/lib/job-crew-notes");
    const saved = saveJobCrewNote({ date: "2026-08-18", jobKey: "appt:1234567", appointmentId: "1234567", body: "Call before arrival; gate code is 1234.", updatedBy: "dispatch@junk-king.com" });
    assert.ok(saved);
    assert.equal(readJobCrewNotes("2026-08-18").size, 1);
    assert.equal(crewJobNotesFromAppointments("Taylor Crew", "2026-08-18", [{ appt_id: "1234567", customer_name: "Test Customer", service_address: "123 Test St", appointment_time: "10:00 AM - 12:00 PM", assigned_truck: "Truck 2", driver_name: "Crew Taylor", additional_crew: ["Taylor Crew"] }], readJobCrewNotes("2026-08-18")).length, 1, "An assigned crew member must see the note.");
    assert.equal(crewJobNotesFromAppointments("Someone Else", "2026-08-18", [{ appt_id: "1234567", driver_name: "Crew Taylor" }], readJobCrewNotes("2026-08-18")).length, 0, "Crew notes must stay scoped to the assigned crew.");
    assert.equal(removeJobCrewNote({ date: "2026-08-18", jobKey: "appt:1234567", appointmentId: "1234567" }), true);
    assert.equal(readJobCrewNotes("2026-08-18").size, 0);
    assert.equal(saveJobCrewNote({ ...saved, appointmentId: "bad", jobKey: "appt:bad" }), null);
    console.log("Job crew note verification passed.");
  } finally { fs.rmSync(directory, { force: true, recursive: true }); }
}

void main();
