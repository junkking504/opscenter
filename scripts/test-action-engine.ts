import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PlatformActor } from "@/lib/platform/contracts";
import { actorCanApprove, decideActionPolicy } from "@/lib/platform/actions/policy";
import { registeredActionDefinition, registeredActionDefinitions } from "@/lib/platform/actions/registry";

const operator: PlatformActor = {
  id: "actor_operator",
  kind: "human",
  externalIdentity: "operator@junk-king.com",
  displayName: "Operator",
  roles: [{ role: "operator", resourceScope: "*" }],
};
const manager: PlatformActor = {
  id: "actor_manager",
  kind: "human",
  externalIdentity: "manager@junk-king.com",
  displayName: "Manager",
  roles: [{ role: "manager", resourceScope: "*" }],
};
const agent: PlatformActor = {
  id: "actor_opsbot",
  kind: "agent",
  externalIdentity: "opsbot",
  displayName: "OpsBot",
  roles: [{ role: "agent", resourceScope: "*" }],
};

const definitions = registeredActionDefinitions();
assert.deepEqual(definitions.map((definition) => definition.key), [
  "work.acknowledge.v1",
  "work.assign_self.v1",
  "work.snooze.v1",
  "work.reopen.v1",
  "work.resolve_manually.v1",
  "dispatch.assign_truck.v1",
  "dispatch.call_ahead.v1",
  "dispatch.reschedule_time.v1",
  "dispatch.cancel_appointment.v1",
  "dispatch.move_date.v1",
  "fleet.mark_out_of_service.v1",
  "fleet.return_to_service.v1",
  "finance.record_manual_bonus.v1",
  "finance.record_payroll_correction.v1",
  "finance.record_payment_exception_review.v1",
  "krewe.record_availability.v1",
  "krewe.schedule_call_in.v1",
  "communications.post_ops_command_notice.v1",
  "marketing.assign_podium_review.v1",
  "systems.record_integration_review.v1",
  "linxup.record_device_review.v1",
]);
assert.equal(new Set(definitions.map((definition) => definition.key)).size, definitions.length);

const acknowledge = registeredActionDefinition("work.acknowledge.v1");
assert.ok(acknowledge);
assert.deepEqual(acknowledge.validateInput({ expectedVersion: 4 }), { expectedVersion: 4 });
assert.throws(() => acknowledge.validateInput({ expectedVersion: 0 }), /expectedVersion/);
assert.equal(decideActionPolicy(acknowledge, operator).decision.outcome, "allow");
assert.equal(
  acknowledge.idempotencyKey({
    actionRunId: "pending",
    entity: { type: "platform", id: "work_123" },
    input: { expectedVersion: 4 },
    correlationId: "corr_test",
  }),
  "work_123|v4",
);

const resolution = registeredActionDefinition("work.resolve_manually.v1");
assert.ok(resolution);
assert.equal(resolution.riskClass, 3);
assert.equal(decideActionPolicy(resolution, operator).decision.outcome, "approval_required");
assert.equal(decideActionPolicy(resolution, manager).decision.outcome, "approval_required");
assert.equal(decideActionPolicy(resolution, agent).decision.outcome, "deny");
assert.throws(() => resolution.validateInput({ expectedVersion: 2, reason: "no" }), /at least 3 characters/);
assert.deepEqual(resolution.validateInput({ expectedVersion: 2, reason: " Verified in JunkWare. " }), {
  expectedVersion: 2,
  reason: "Verified in JunkWare.",
});
assert.equal(actorCanApprove(operator, "manager"), false);
assert.equal(actorCanApprove(manager, "manager"), true);
assert.equal(actorCanApprove(manager, "admin"), false);

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const engine = read("lib/platform/actions/engine.ts");
for (const contract of [
  "createPersistedActionRun",
  "executeActionRun",
  "decidePersistedApproval",
  "verification.outcome === \"verified\"",
  "Approval-gated actions require approval from a different manager or administrator.",
]) {
  assert.ok(engine.includes(contract), `Action engine is missing ${contract}.`);
}

const persistence = read("lib/platform/persistence/action-runs.ts");
for (const contract of [
  "ON CONFLICT (action_key, idempotency_key) DO NOTHING",
  "FOR UPDATE",
  "action.requested.v1",
  "action.approved.v1",
  "action.denied.v1",
]) {
  assert.ok(persistence.includes(contract), `Action persistence is missing ${contract}.`);
}

const actors = read("lib/platform/persistence/actors.ts");
assert.match(actors, /role IN \('admin', 'manager', 'operator'\)[\s\S]*role <> \$2/, "Interactive kernel roles must be synchronized when OpsCenter access changes.");

const consoleSource = read("components/OpsBotActionConsole.tsx");
for (const control of [
  "Control OpsCenter through registered actions",
  "Acknowledge",
  "Assign to me",
  "Snooze 1 hour",
  "Request resolution approval",
  "Action ledger",
  "Dispatch control pack",
  "Request truck approval",
  "Request time approval",
  "Request cancellation approval",
  "Request date move approval",
  "Fleet control pack",
  "Request out-of-service approval",
  "Request return-to-service approval",
  "Finance control pack",
  "Request exception review approval",
  "Request bonus approval",
  "Request payroll correction approval",
  "Krewe control pack",
  "Mark available",
  "Mark unavailable",
  "Request call-in approval",
  "Communications control pack",
  "Request Slack notice approval",
  "Marketing control pack",
  "Request confirm approval",
  "Request re-assignment approval",
  "Systems control pack",
  "Request recovery review approval",
  "LinxUp control pack",
  "Request device review approval",
  "Mark called",
]) {
  assert.ok(consoleSource.includes(control), `OpsBot console is missing ${control}.`);
}

const assignment = registeredActionDefinition("dispatch.assign_truck.v1");
assert.ok(assignment);
assert.equal(assignment.riskClass, 2);
assert.equal(decideActionPolicy(assignment, operator).decision.outcome, "approval_required");
assert.deepEqual(assignment.validateInput({
  date: "2026-08-31",
  appointmentId: "4056261",
  jobKey: "appt:4056261",
  truck: "Truck# 4",
  expectedSourceTruck: "Truck 2",
  expectedRouteUpdatedAt: "",
  sourceObservedAt: "2026-08-31T18:30:00.000Z",
}), {
  date: "2026-08-31",
  appointmentId: "4056261",
  jobKey: "appt:4056261",
  truck: "Truck 4",
  expectedSourceTruck: "Truck 2",
  expectedRouteUpdatedAt: "",
  sourceObservedAt: "2026-08-31T18:30:00.000Z",
});

const callAhead = registeredActionDefinition("dispatch.call_ahead.v1");
assert.ok(callAhead);
assert.equal(decideActionPolicy(callAhead, operator).decision.outcome, "allow");

const reschedule = registeredActionDefinition("dispatch.reschedule_time.v1");
assert.ok(reschedule);
assert.equal(reschedule.riskClass, 2);
assert.equal(decideActionPolicy(reschedule, operator).decision.outcome, "approval_required");
assert.deepEqual(reschedule.validateInput({
  date: "2026-08-31",
  appointmentId: "4056261",
  jobKey: "appt:4056261",
  appointmentStartMinutes: 600,
  durationHours: 2,
  expectedAppointmentTime: "08:00 AM - 10:00 AM",
  expectedEffectiveTruck: "Truck# 4",
  expectedRouteUpdatedAt: "",
  sourceObservedAt: "2026-08-31T18:30:00.000Z",
}), {
  date: "2026-08-31",
  appointmentId: "4056261",
  jobKey: "appt:4056261",
  appointmentStartMinutes: 600,
  durationHours: 2,
  expectedAppointmentTime: "08:00 AM - 10:00 AM",
  expectedEffectiveTruck: "Truck 4",
  expectedRouteUpdatedAt: "",
  sourceObservedAt: "2026-08-31T18:30:00.000Z",
});
assert.throws(() => reschedule.validateInput({
  date: "2026-08-31",
  appointmentId: "4056261",
  jobKey: "appt:4056261",
  appointmentStartMinutes: 615,
  durationHours: 1,
  expectedAppointmentTime: "08:00 AM - 09:00 AM",
  sourceObservedAt: "2026-08-31T18:30:00.000Z",
}), /hourly appointment time/);

const cancellation = registeredActionDefinition("dispatch.cancel_appointment.v1");
assert.ok(cancellation);
assert.equal(cancellation.riskClass, 3);
assert.equal(decideActionPolicy(cancellation, operator).decision.outcome, "approval_required");
assert.throws(() => cancellation.validateInput({
  date: "2026-08-31",
  appointmentId: "4056261",
  jobKey: "appt:4056261",
  cancellationReason: "no",
  expectedStatus: "Confirmed",
  expectedAppointmentTime: "08:00 AM - 09:00 AM",
  sourceObservedAt: "2026-08-31T18:30:00.000Z",
}), /at least 3 characters/);

const dateMove = registeredActionDefinition("dispatch.move_date.v1");
assert.ok(dateMove);
assert.equal(dateMove.riskClass, 3);
assert.equal(decideActionPolicy(dateMove, operator).decision.outcome, "approval_required");
assert.deepEqual(dateMove.validateInput({
  date: "2026-08-31",
  appointmentId: "4056261",
  jobKey: "appt:4056261",
  destinationDate: "2026-09-01",
  appointmentStartMinutes: 660,
  expectedAppointmentStartMinutes: 600,
  expectedAppointmentTime: "10:00 AM - 11:00 AM",
  expectedStatus: "Confirmed",
  expectedRouteUpdatedAt: "",
  sourceObservedAt: "2026-08-31T18:30:00.000Z",
}), {
  date: "2026-08-31",
  appointmentId: "4056261",
  jobKey: "appt:4056261",
  destinationDate: "2026-09-01",
  appointmentStartMinutes: 660,
  expectedAppointmentStartMinutes: 600,
  expectedAppointmentTime: "10:00 AM - 11:00 AM",
  expectedStatus: "Confirmed",
  expectedRouteUpdatedAt: "",
  sourceObservedAt: "2026-08-31T18:30:00.000Z",
});
assert.throws(() => dateMove.validateInput({
  date: "2026-08-31",
  appointmentId: "4056261",
  jobKey: "appt:4056261",
  destinationDate: "2026-08-31",
  appointmentStartMinutes: 660,
  expectedAppointmentStartMinutes: 600,
  expectedAppointmentTime: "10:00 AM - 11:00 AM",
  expectedStatus: "Confirmed",
  sourceObservedAt: "2026-08-31T18:30:00.000Z",
}), /different destination date/);

const fleetHold = registeredActionDefinition("fleet.mark_out_of_service.v1");
assert.ok(fleetHold);
assert.equal(fleetHold.riskClass, 3);
assert.equal(decideActionPolicy(fleetHold, operator).decision.outcome, "approval_required");
assert.deepEqual(fleetHold.validateInput({
  truck: "Truck 4",
  reason: " Hydraulic leak at lift gate ",
  expectedStoreUpdatedAt: "2026-08-31T20:00:00.000Z",
}), {
  truck: "Truck# 4",
  reason: "Hydraulic leak at lift gate",
  expectedStoreUpdatedAt: "2026-08-31T20:00:00.000Z",
});
assert.throws(() => fleetHold.validateInput({
  truck: "Truck 4",
  reason: "bad",
  expectedStoreUpdatedAt: "",
}), /at least 5 characters/);

const fleetReturn = registeredActionDefinition("fleet.return_to_service.v1");
assert.ok(fleetReturn);
assert.equal(fleetReturn.riskClass, 3);
assert.equal(decideActionPolicy(fleetReturn, manager).decision.outcome, "approval_required");
assert.deepEqual(fleetReturn.validateInput({
  truck: "Truck# 4",
  issueId: "issue-4",
  resolution: " Hose replaced and pressure tested ",
  expectedStoreUpdatedAt: "2026-08-31T20:05:00.000Z",
  expectedIssueUpdatedAt: "2026-08-31T20:04:00.000Z",
}), {
  truck: "Truck# 4",
  issueId: "issue-4",
  resolution: "Hose replaced and pressure tested",
  expectedStoreUpdatedAt: "2026-08-31T20:05:00.000Z",
  expectedIssueUpdatedAt: "2026-08-31T20:04:00.000Z",
});
assert.throws(() => fleetReturn.validateInput({
  truck: "Truck# 4",
  issueId: "issue-4",
  resolution: "done",
  expectedStoreUpdatedAt: "",
  expectedIssueUpdatedAt: "2026-08-31T20:04:00.000Z",
}), /at least 5 characters/);

const manualBonus = registeredActionDefinition("finance.record_manual_bonus.v1");
assert.ok(manualBonus);
assert.equal(manualBonus.riskClass, 3);
assert.equal(decideActionPolicy(manualBonus, operator).decision.outcome, "deny");
assert.equal(decideActionPolicy(manualBonus, manager).decision.outcome, "approval_required");
assert.deepEqual(manualBonus.validateInput({
  employeeName: " Morgan   Lee ",
  workDate: "2026-08-31",
  amount: 40.505,
  note: " Approved safety leadership bonus ",
  expectedBonusStoreUpdatedAt: "2026-08-31T20:10:00.000Z",
}), {
  employeeName: "Morgan Lee",
  workDate: "2026-08-31",
  amount: 40.51,
  note: "Approved safety leadership bonus",
  expectedBonusStoreUpdatedAt: "2026-08-31T20:10:00.000Z",
});
assert.throws(() => manualBonus.validateInput({
  employeeName: "Morgan Lee",
  workDate: "2026-08-31",
  amount: 10_001,
  note: "Over the bounded maximum",
  expectedBonusStoreUpdatedAt: "",
}), /no more than/);

const payrollCorrection = registeredActionDefinition("finance.record_payroll_correction.v1");
assert.ok(payrollCorrection);
assert.equal(payrollCorrection.riskClass, 3);
assert.equal(decideActionPolicy(payrollCorrection, operator).decision.outcome, "deny");
assert.equal(decideActionPolicy(payrollCorrection, manager).decision.outcome, "approval_required");
assert.deepEqual(payrollCorrection.validateInput({
  employeeName: "Alex Rivera",
  workDate: "2026-08-31",
  clockIn: "7:45 am",
  clockOut: "4:15 pm",
  hourlyRate: 24.5,
  note: " Manager verified timecard evidence ",
  expectedPayrollStoreUpdatedAt: "2026-08-31T20:12:00.000Z",
  expectedCorrectionUpdatedAt: "",
}), {
  employeeName: "Alex Rivera",
  workDate: "2026-08-31",
  clockIn: "07:45 AM",
  clockOut: "04:15 PM",
  hourlyRate: 24.5,
  note: "Manager verified timecard evidence",
  expectedPayrollStoreUpdatedAt: "2026-08-31T20:12:00.000Z",
  expectedCorrectionUpdatedAt: "",
});
assert.throws(() => payrollCorrection.validateInput({
  employeeName: "Alex Rivera",
  workDate: "2026-08-31",
  clockIn: "07:45",
  clockOut: "",
  hourlyRate: 24.5,
  note: "Missing meridiem",
  expectedPayrollStoreUpdatedAt: "",
  expectedCorrectionUpdatedAt: "",
}), /HH:MM AM\/PM/);

const paymentExceptionReview = registeredActionDefinition("finance.record_payment_exception_review.v1");
assert.ok(paymentExceptionReview);
assert.equal(paymentExceptionReview.riskClass, 2);
assert.equal(decideActionPolicy(paymentExceptionReview, operator).decision.outcome, "deny");
assert.equal(decideActionPolicy(paymentExceptionReview, manager).decision.outcome, "approval_required");
assert.deepEqual(paymentExceptionReview.validateInput({
  date: "2026-09-01",
  exceptionId: `payment_exception_${"a".repeat(24)}`,
  disposition: "qbo_follow_up",
  owner: " Mission   Control ",
  nextAction: " Verify the QBO transaction and refresh reconciliation. ",
  note: " JunkWare reference and amount reviewed against the current snapshot. ",
  expectedReviewStoreUpdatedAt: "",
  expectedReviewUpdatedAt: "",
  expectedObservationKey: "b".repeat(64),
}), {
  date: "2026-09-01",
  exceptionId: `payment_exception_${"a".repeat(24)}`,
  disposition: "qbo_follow_up",
  owner: "Mission Control",
  nextAction: "Verify the QBO transaction and refresh reconciliation.",
  note: "JunkWare reference and amount reviewed against the current snapshot.",
  expectedReviewStoreUpdatedAt: "",
  expectedReviewUpdatedAt: "",
  expectedObservationKey: "b".repeat(64),
});
assert.throws(() => paymentExceptionReview.validateInput({
  date: "2026-09-01",
  exceptionId: `payment_exception_${"a".repeat(24)}`,
  disposition: "clear_in_qbo",
  owner: "Mission Control",
  nextAction: "Change the transaction.",
  note: "Reviewed the source evidence.",
  expectedReviewStoreUpdatedAt: "",
  expectedReviewUpdatedAt: "",
  expectedObservationKey: "b".repeat(64),
}), /valid payment review disposition/);
assert.throws(() => paymentExceptionReview.validateInput({
  date: "2026-09-01",
  exceptionId: `payment_exception_${"a".repeat(24)}`,
  disposition: "keep_open",
  owner: "Mission Control",
  nextAction: "Keep the source exception open.",
  note: "Card 4111 1111 1111 1111 needs review.",
  expectedReviewStoreUpdatedAt: "",
  expectedReviewUpdatedAt: "",
  expectedObservationKey: "b".repeat(64),
}), /cannot contain credentials, contact details, or payment-card data/);

const kreweAvailability = registeredActionDefinition("krewe.record_availability.v1");
assert.ok(kreweAvailability);
assert.equal(kreweAvailability.riskClass, 1);
assert.equal(decideActionPolicy(kreweAvailability, operator).decision.outcome, "allow");
assert.equal(decideActionPolicy(kreweAvailability, manager).decision.outcome, "allow");
assert.deepEqual(kreweAvailability.validateInput({
  employeeName: " Morgan   Lee ",
  targetDate: "2026-09-01",
  status: "available",
  note: " Confirmed by phone ",
  expectedStoreUpdatedAt: "2026-08-31T20:15:00.000Z",
  expectedRecordUpdatedAt: "",
}), {
  employeeName: "Morgan Lee",
  targetDate: "2026-09-01",
  status: "available",
  note: "Confirmed by phone",
  expectedStoreUpdatedAt: "2026-08-31T20:15:00.000Z",
  expectedRecordUpdatedAt: "",
});
assert.throws(() => kreweAvailability.validateInput({
  employeeName: "Morgan Lee",
  targetDate: "2026-09-01",
  status: "maybe",
  note: "Confirmed by phone",
  expectedStoreUpdatedAt: "",
  expectedRecordUpdatedAt: "",
}), /available or unavailable/);

const kreweCallIn = registeredActionDefinition("krewe.schedule_call_in.v1");
assert.ok(kreweCallIn);
assert.equal(kreweCallIn.riskClass, 2);
assert.equal(decideActionPolicy(kreweCallIn, operator).decision.outcome, "approval_required");
assert.equal(decideActionPolicy(kreweCallIn, manager).decision.outcome, "approval_required");
assert.deepEqual(kreweCallIn.validateInput({
  employeeName: "Morgan Lee",
  baseDate: "2026-08-31",
  targetDate: "2026-09-01",
  role: "Crew",
  note: "Confirmed by phone for tomorrow",
  availabilityConfirmed: true,
  expectedScheduleUpdatedAt: "2026-08-31T20:14:00.000Z",
  expectedStoreUpdatedAt: "2026-08-31T20:15:00.000Z",
  expectedRecordUpdatedAt: "2026-08-31T20:15:00.000Z",
}), {
  employeeName: "Morgan Lee",
  baseDate: "2026-08-31",
  targetDate: "2026-09-01",
  role: "crew",
  note: "Confirmed by phone for tomorrow",
  availabilityConfirmed: true,
  expectedScheduleUpdatedAt: "2026-08-31T20:14:00.000Z",
  expectedStoreUpdatedAt: "2026-08-31T20:15:00.000Z",
  expectedRecordUpdatedAt: "2026-08-31T20:15:00.000Z",
});
assert.throws(() => kreweCallIn.validateInput({
  employeeName: "Morgan Lee",
  baseDate: "2026-08-31",
  targetDate: "2026-09-02",
  role: "crew",
  note: "Confirmed by phone for tomorrow",
  availabilityConfirmed: true,
  expectedScheduleUpdatedAt: "2026-08-31T20:14:00.000Z",
  expectedStoreUpdatedAt: "",
  expectedRecordUpdatedAt: "",
}), /next operating day/);
assert.throws(() => kreweCallIn.validateInput({
  employeeName: "Morgan Lee",
  baseDate: "2026-08-31",
  targetDate: "2026-09-01",
  role: "crew",
  note: "Confirmed by phone for tomorrow",
  availabilityConfirmed: false,
  expectedScheduleUpdatedAt: "2026-08-31T20:14:00.000Z",
  expectedStoreUpdatedAt: "",
  expectedRecordUpdatedAt: "",
}), /Human-confirmed employee availability/);

const opsCommandNotice = registeredActionDefinition("communications.post_ops_command_notice.v1");
assert.ok(opsCommandNotice);
assert.equal(opsCommandNotice.riskClass, 2);
assert.equal(decideActionPolicy(opsCommandNotice, operator).decision.outcome, "approval_required");
assert.equal(decideActionPolicy(opsCommandNotice, manager).decision.outcome, "approval_required");
assert.deepEqual(opsCommandNotice.validateInput({
  subject: " Route plan updated ",
  message: " The afternoon route plan is ready for field review. ",
  owner: " Dispatch lead ",
  nextAction: " Review the board before departure. ",
}), {
  subject: "Route plan updated",
  message: "The afternoon route plan is ready for field review.",
  owner: "Dispatch lead",
  nextAction: "Review the board before departure.",
});
assert.throws(() => opsCommandNotice.validateInput({
  subject: "Customer follow-up",
  message: "Call customer@example.com before the route leaves.",
  owner: "Dispatch lead",
  nextAction: "Confirm the customer contact.",
}), /cannot contain credentials, customer contact details, or payment-card data/);
assert.throws(() => opsCommandNotice.validateInput({
  subject: "Token update",
  message: "Use token=xoxb-secret-value for the next delivery.",
  owner: "Dispatch lead",
  nextAction: "Confirm the integration status.",
}), /cannot contain credentials, customer contact details, or payment-card data/);

const podiumAttribution = registeredActionDefinition("marketing.assign_podium_review.v1");
assert.ok(podiumAttribution);
assert.equal(podiumAttribution.riskClass, 2);
assert.equal(decideActionPolicy(podiumAttribution, operator).decision.outcome, "deny");
assert.equal(decideActionPolicy(podiumAttribution, manager).decision.outcome, "approval_required");
assert.deepEqual(podiumAttribution.validateInput({
  reviewUid: " review-12345678 ",
  appointmentReference: " JK4061853 ",
  assignmentMode: "confirm_suggestion",
  expectedSnapshotFetchedAt: "2026-09-01T13:22:07.918Z",
  expectedReviewUpdatedAt: "2026-08-31T19:16:15.000Z",
  expectedAssignmentStoreUpdatedAt: "",
  expectedAssignmentUpdatedAt: "",
  expectedCandidateKey: "a".repeat(64),
  expectedCandidateAppointmentId: "4048675",
  expectedCandidateJkNumber: "JK4061853",
  expectedCandidateCrew: [" Ivory Grace ", "Jonathan Myles", "Ivory Grace"],
}), {
  reviewUid: "review-12345678",
  appointmentReference: "JK4061853",
  assignmentMode: "confirm_suggestion",
  expectedSnapshotFetchedAt: "2026-09-01T13:22:07.918Z",
  expectedReviewUpdatedAt: "2026-08-31T19:16:15.000Z",
  expectedAssignmentStoreUpdatedAt: "",
  expectedAssignmentUpdatedAt: "",
  expectedCandidateKey: "a".repeat(64),
  expectedCandidateAppointmentId: "4048675",
  expectedCandidateJkNumber: "JK4061853",
  expectedCandidateCrew: ["Ivory Grace", "Jonathan Myles"],
});
assert.throws(() => podiumAttribution.validateInput({
  reviewUid: "review-12345678",
  appointmentReference: "JK4061853",
  assignmentMode: "automatic",
  expectedSnapshotFetchedAt: "2026-09-01T13:22:07.918Z",
  expectedReviewUpdatedAt: "2026-08-31T19:16:15.000Z",
  expectedAssignmentStoreUpdatedAt: "",
  expectedAssignmentUpdatedAt: "",
  expectedCandidateKey: "a".repeat(64),
  expectedCandidateAppointmentId: "4048675",
  expectedCandidateJkNumber: "JK4061853",
  expectedCandidateCrew: ["Ivory Grace"],
}), /confirm suggestion or re-assign/);

const systemsReview = registeredActionDefinition("systems.record_integration_review.v1");
assert.ok(systemsReview);
assert.equal(systemsReview.riskClass, 2);
assert.equal(decideActionPolicy(systemsReview, operator).decision.outcome, "approval_required");
assert.equal(decideActionPolicy(systemsReview, manager).decision.outcome, "approval_required");
assert.deepEqual(systemsReview.validateInput({
  date: "2026-09-01",
  integrationId: " qbo_reconciliation ",
  disposition: "credential_follow_up",
  owner: " Finance manager ",
  nextAction: " Verify the approved connection and refresh reconciliation. ",
  note: " Current merchant collection is unavailable. ",
  expectedReviewStoreUpdatedAt: "",
  expectedReviewUpdatedAt: "",
  expectedObservationKey: "a".repeat(64),
}), {
  date: "2026-09-01",
  integrationId: "qbo_reconciliation",
  disposition: "credential_follow_up",
  owner: "Finance manager",
  nextAction: "Verify the approved connection and refresh reconciliation.",
  note: "Current merchant collection is unavailable.",
  expectedReviewStoreUpdatedAt: "",
  expectedReviewUpdatedAt: "",
  expectedObservationKey: "a".repeat(64),
});
assert.throws(() => systemsReview.validateInput({
  date: "2026-09-01",
  integrationId: "qbo_reconciliation",
  disposition: "source_recovery",
  owner: "Finance manager",
  nextAction: "Use token=xoxb-secret-value to reconnect.",
  note: "Reconnect the integration.",
  expectedReviewStoreUpdatedAt: "",
  expectedReviewUpdatedAt: "",
  expectedObservationKey: "a".repeat(64),
}), /cannot contain credentials/);

const linxupDeviceReview = registeredActionDefinition("linxup.record_device_review.v1");
assert.ok(linxupDeviceReview);
assert.equal(linxupDeviceReview.riskClass, 2);
assert.equal(decideActionPolicy(linxupDeviceReview, operator).decision.outcome, "approval_required");
assert.equal(decideActionPolicy(linxupDeviceReview, manager).decision.outcome, "approval_required");
assert.deepEqual(linxupDeviceReview.validateInput({
  date: "2026-09-01",
  truck: " Truck 2 ",
  disposition: "provider_follow_up",
  note: " Verify the silent V3 push lane with the provider. ",
  expectedStoreUpdatedAt: "",
  expectedRecordUpdatedAt: "",
  expectedObservationKey: "a".repeat(64),
}), {
  date: "2026-09-01",
  truck: "Truck# 2",
  disposition: "provider_follow_up",
  note: "Verify the silent V3 push lane with the provider.",
  expectedStoreUpdatedAt: "",
  expectedRecordUpdatedAt: "",
  expectedObservationKey: "a".repeat(64),
});
assert.throws(() => linxupDeviceReview.validateInput({
  date: "2026-09-01",
  truck: "Truck 2",
  disposition: "fixed",
  note: "Provider repaired the tracker.",
  expectedStoreUpdatedAt: "",
  expectedRecordUpdatedAt: "",
  expectedObservationKey: "a".repeat(64),
}), /valid LinxUp review disposition/);
assert.throws(() => linxupDeviceReview.validateInput({
  date: "2026-09-01",
  truck: "Truck 2",
  disposition: "provider_follow_up",
  note: "Use token=xoxb-secret-value when reviewing the device.",
  expectedStoreUpdatedAt: "",
  expectedRecordUpdatedAt: "",
  expectedObservationKey: "a".repeat(64),
}), /cannot contain credentials, contact details, or payment-card data/);
assert.equal(linxupDeviceReview.validateInput({
  date: "2026-09-01",
  truck: "Truck 2",
  disposition: "provider_follow_up",
  note: "Provider review receipt 1788268000000 is attached.",
  expectedStoreUpdatedAt: "",
  expectedRecordUpdatedAt: "",
  expectedObservationKey: "a".repeat(64),
}).note, "Provider review receipt 1788268000000 is attached.");
assert.throws(() => linxupDeviceReview.validateInput({
  date: "2026-09-01",
  truck: "Truck 2",
  disposition: "provider_follow_up",
  note: "Do not store payment card 4111 1111 1111 1111 here.",
  expectedStoreUpdatedAt: "",
  expectedRecordUpdatedAt: "",
  expectedObservationKey: "a".repeat(64),
}), /cannot contain credentials, contact details, or payment-card data/);

console.log("OpsBot action registry, policy, idempotency, approvals, verification, persistence, and control UI contracts passed.");
