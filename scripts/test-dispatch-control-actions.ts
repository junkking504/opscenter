import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-dispatch-control-"));
const date = "2026-08-31";
process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";
process.env.OPSBOT_DATA_DIR = temporary;
process.env.JOB_ROUTE_ASSIGNMENTS_FILE = path.join(temporary, "state", "assignments.json");
process.env.JOB_CALL_AHEAD_FILE = path.join(temporary, "state", "call-ahead.json");

const scheduleDirectory = path.join(temporary, "history", "junkware");
fs.mkdirSync(scheduleDirectory, { recursive: true });
const scheduleFile = path.join(scheduleDirectory, `junkware_schedule_fast_${date}.json`);
fs.writeFileSync(scheduleFile, JSON.stringify({
  date,
  scraped_at: "2026-08-31T18:30:00.000Z",
  markets_scraped: [
    "Junk King New Orleans",
    "Junk King Northshore",
    "Junk King Baton Rouge",
    "Junk King Jefferson Parish",
  ],
  appointments: [
    { appt_id: "4056261", job_id: "JK4069439", customer_name: "Preview Customer", appointment_time: "08:00 AM - 09:00 AM", appointment_type: "Job", job_status: "Confirmed", truck: "Truck# 4", normalized_territory: "New Orleans" },
    { appt_id: "4056486", job_id: "JK4069664", appointment_time: "09:00 AM - 10:00 AM", job_status: "Completed", truck: "Truck# 9" },
  ],
  cancelled: [],
}));

const {
  executeDispatchAssignment,
  executeDispatchCallAhead,
  readDispatchControlSnapshot,
  verifyDispatchAssignment,
  verifyDispatchCallAhead,
} = await import("@/lib/dispatch-control");

try {
  const snapshot = readDispatchControlSnapshot(date);
  assert.equal(snapshot.mode, "preview_simulation");
  assert.equal(snapshot.appointments.length, 1, "Completed appointments must not be controllable.");
  const appointment = snapshot.appointments[0];
  assert.equal(appointment.sourceTruck, "Truck 4");

  const assignmentInput = {
    date,
    appointmentId: appointment.appointmentId,
    jobKey: appointment.jobKey,
    truck: "Truck 2",
    expectedSourceTruck: appointment.sourceTruck,
    expectedRouteUpdatedAt: appointment.routeUpdatedAt,
    sourceObservedAt: appointment.sourceObservedAt,
  };
  const assignment = await executeDispatchAssignment(assignmentInput);
  assert.equal(assignment.mode, "preview_simulation");
  assert.equal(verifyDispatchAssignment(assignment, assignmentInput).outcome, "verified");
  assert.equal(fs.existsSync(process.env.JOB_ROUTE_ASSIGNMENTS_FILE), false, "Preview assignment simulation must not write shared route state.");

  const callAheadInput = {
    date,
    appointmentId: appointment.appointmentId,
    jobKey: appointment.jobKey,
    status: "called" as const,
    expectedStatus: "" as const,
    sourceObservedAt: appointment.sourceObservedAt,
  };
  const callAhead = executeDispatchCallAhead(callAheadInput);
  assert.equal(callAhead.mode, "preview_simulation");
  assert.equal(verifyDispatchCallAhead(callAhead, callAheadInput).outcome, "verified");
  assert.equal(fs.existsSync(process.env.JOB_CALL_AHEAD_FILE), false, "Preview call-ahead simulation must not write shared dispatch state.");

  process.env.OPSCENTER_RUNTIME = "MISSION_CONTROL";
  process.env.JUNKWARE_ASSIGNMENT_STUB = "1";
  const liveAssignment = await executeDispatchAssignment(assignmentInput);
  assert.equal(liveAssignment.mode, "live_control");
  assert.equal(verifyDispatchAssignment(liveAssignment, assignmentInput).outcome, "verified");
  assert.equal(fs.existsSync(process.env.JOB_ROUTE_ASSIGNMENTS_FILE), true, "Mission Control assignment must persist verified route state.");

  const liveCallAhead = executeDispatchCallAhead(callAheadInput);
  assert.equal(liveCallAhead.mode, "live_control");
  assert.equal(verifyDispatchCallAhead(liveCallAhead, callAheadInput).outcome, "verified");
  assert.throws(
    () => executeDispatchCallAhead(callAheadInput),
    /VERSION_CONFLICT/,
    "A stale call-ahead command must not overwrite newer state.",
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("Dispatch roster, action policy, preview isolation, and verification contracts passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
