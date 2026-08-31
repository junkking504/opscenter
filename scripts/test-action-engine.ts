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
  "Request bonus approval",
  "Request payroll correction approval",
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

console.log("OpsBot action registry, policy, idempotency, approvals, verification, persistence, and control UI contracts passed.");
