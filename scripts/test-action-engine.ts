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

console.log("OpsBot action registry, policy, idempotency, approvals, verification, persistence, and control UI contracts passed.");
