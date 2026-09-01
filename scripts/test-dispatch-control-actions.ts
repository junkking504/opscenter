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
process.env.JOB_CANCELLATIONS_FILE = path.join(temporary, "state", "cancellations.json");
process.env.JOB_RESCHEDULES_FILE = path.join(temporary, "state", "reschedules.json");

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
    { appt_id: "4056261", job_id: "JK4069439", customer_name: "Preview Customer", phone: "504-555-0101", appointment_time: "08:00 AM - 09:00 AM", appointment_type: "Job", job_status: "Confirmed", truck: "Truck# 4", normalized_territory: "New Orleans" },
    { appt_id: "4056262", job_id: "JK4069440", customer_name: "Cancellation Customer", phone: "985-555-0102", appointment_time: "12:00 PM - 01:00 PM", appointment_type: "Job", job_status: "Confirmed", truck: "Truck# 5", normalized_territory: "Northshore" },
    { appt_id: "4056486", job_id: "JK4069664", appointment_time: "09:00 AM - 10:00 AM", job_status: "Completed", truck: "Truck# 9" },
  ],
  cancelled: [],
}));

const {
  executeDispatchAssignment,
  executeDispatchCancellation,
  executeDispatchCallAhead,
  executeDispatchDateMove,
  executeDispatchReschedule,
  readDispatchControlSnapshot,
  verifyDispatchAssignment,
  verifyDispatchCancellation,
  verifyDispatchCallAhead,
  verifyDispatchDateMove,
  verifyDispatchReschedule,
} = await import("@/lib/dispatch-control");

try {
  const snapshot = readDispatchControlSnapshot(date);
  assert.equal(snapshot.mode, "preview_simulation");
  assert.equal(snapshot.appointments.length, 2, "Completed appointments must not be controllable.");
  const appointment = snapshot.appointments[0];
  const cancellationAppointment = snapshot.appointments[1];
  assert.equal(appointment.sourceTruck, "Truck 4");
  assert.equal(appointment.appointmentStartMinutes, 8 * 60);
  assert.equal(appointment.phone, "504-555-0101");
  assert.match(appointment.contactObservationKey, /^[0-9a-f]{64}$/);

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

  const rescheduleInput = {
    date,
    appointmentId: appointment.appointmentId,
    jobKey: appointment.jobKey,
    appointmentStartMinutes: 10 * 60,
    durationHours: 1,
    expectedAppointmentTime: appointment.appointmentTime,
    expectedEffectiveTruck: appointment.effectiveTruck,
    expectedRouteUpdatedAt: appointment.routeUpdatedAt,
    sourceObservedAt: appointment.sourceObservedAt,
  };
  const reschedule = await executeDispatchReschedule(rescheduleInput);
  assert.equal(reschedule.mode, "preview_simulation");
  assert.equal(verifyDispatchReschedule(reschedule, rescheduleInput).outcome, "verified");
  assert.equal(fs.existsSync(process.env.JOB_ROUTE_ASSIGNMENTS_FILE), false, "Preview reschedule simulation must not write shared route state.");

  const cancellationInput = {
    date,
    appointmentId: cancellationAppointment.appointmentId,
    jobKey: cancellationAppointment.jobKey,
    cancellationReason: "Customer requested cancellation",
    expectedStatus: cancellationAppointment.status,
    expectedAppointmentTime: cancellationAppointment.appointmentTime,
    expectedRouteUpdatedAt: cancellationAppointment.routeUpdatedAt,
    sourceObservedAt: cancellationAppointment.sourceObservedAt,
  };
  const cancellation = await executeDispatchCancellation(cancellationInput);
  assert.equal(cancellation.mode, "preview_simulation");
  assert.equal(verifyDispatchCancellation(cancellation, cancellationInput).outcome, "verified");
  assert.equal(fs.existsSync(process.env.JOB_CANCELLATIONS_FILE), false, "Preview cancellation simulation must not write shared cancellation state.");

  const dateMoveInput = {
    date,
    appointmentId: appointment.appointmentId,
    jobKey: appointment.jobKey,
    destinationDate: "2026-09-01",
    appointmentStartMinutes: 11 * 60,
    expectedAppointmentStartMinutes: appointment.appointmentStartMinutes!,
    expectedAppointmentTime: appointment.appointmentTime,
    expectedStatus: appointment.status,
    expectedRouteUpdatedAt: appointment.routeUpdatedAt,
    sourceObservedAt: appointment.sourceObservedAt,
  };
  const dateMove = await executeDispatchDateMove(dateMoveInput);
  assert.equal(dateMove.mode, "preview_simulation");
  assert.equal(verifyDispatchDateMove(dateMove, dateMoveInput).outcome, "verified");
  assert.equal(fs.existsSync(process.env.JOB_ROUTE_ASSIGNMENTS_FILE), false, "Preview date move simulation must not write shared route state.");
  assert.equal(fs.existsSync(process.env.JOB_RESCHEDULES_FILE), false, "Preview date move simulation must not write verified move state.");

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

  const afterAssignment = readDispatchControlSnapshot(date).appointments[0];
  const liveRescheduleInput = {
    ...rescheduleInput,
    expectedAppointmentTime: afterAssignment.appointmentTime,
    expectedEffectiveTruck: afterAssignment.effectiveTruck,
    expectedRouteUpdatedAt: afterAssignment.routeUpdatedAt,
  };
  const liveReschedule = await executeDispatchReschedule(liveRescheduleInput);
  assert.equal(liveReschedule.mode, "live_control");
  assert.equal(verifyDispatchReschedule(liveReschedule, liveRescheduleInput).outcome, "verified");
  await assert.rejects(
    () => executeDispatchReschedule(liveRescheduleInput),
    /VERSION_CONFLICT/,
    "A stale reschedule request must not overwrite a newer verified time.",
  );

  const afterReschedule = readDispatchControlSnapshot(date).appointments[0];
  process.env.JUNKWARE_APPOINTMENT_RESCHEDULE_STUB = "1";
  const liveDateMoveInput = {
    ...dateMoveInput,
    appointmentStartMinutes: 11 * 60,
    expectedAppointmentStartMinutes: afterReschedule.appointmentStartMinutes!,
    expectedAppointmentTime: afterReschedule.appointmentTime,
    expectedStatus: afterReschedule.status,
    expectedRouteUpdatedAt: afterReschedule.routeUpdatedAt,
  };
  const liveDateMove = await executeDispatchDateMove(liveDateMoveInput);
  assert.equal(liveDateMove.mode, "live_control");
  assert.equal(verifyDispatchDateMove(liveDateMove, liveDateMoveInput).outcome, "verified");
  assert.equal(fs.existsSync(process.env.JOB_RESCHEDULES_FILE), true, "Mission Control date moves must persist a verified receipt.");

  process.env.JUNKWARE_APPOINTMENT_CANCELLATION_STUB = "1";
  const liveCancellationInput = {
    ...cancellationInput,
  };
  const liveCancellation = await executeDispatchCancellation(liveCancellationInput);
  assert.equal(liveCancellation.mode, "live_control");
  assert.equal(verifyDispatchCancellation(liveCancellation, liveCancellationInput).outcome, "verified");
  assert.equal(fs.existsSync(process.env.JOB_CANCELLATIONS_FILE), true, "Mission Control cancellation must persist a verified receipt.");
  assert.equal(readDispatchControlSnapshot(date).appointments.length, 0, "Verified moves and cancellations must leave the stale source-date roster immediately.");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("Dispatch roster, assignment, call-ahead, reschedule, cross-date move, cancellation, preview isolation, and verification contracts passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
