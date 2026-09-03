import assert from "node:assert/strict";
import { Pool } from "pg";
import { COMMAND_ALERT_RULE, commandAlertControlHref, commandAlertState } from "../lib/command-alert-workflow";
import { saveCommandAlertWorkItem, type DetectedWorkItemInput } from "../lib/platform/persistence/work-items";

// Transaction-contract test only: all queries are intercepted in memory. This
// script cannot contact a database, Slack, JunkWare, or the live application.
type Row = Record<string, unknown>;
let rows = new Map<string, Row>();
let events: unknown[][] = [];
let saved: { rows: Map<string, Row>; events: unknown[][] };
let failEvent = false;
const query = async (sql: string, values: unknown[] = []) => {
  const statement = sql.trim().replace(/\s+/g, " ");
  if (statement === "BEGIN") { saved = structuredClone({ rows, events }); return { rows: [] }; }
  if (statement === "COMMIT") return { rows: [] };
  if (statement === "ROLLBACK") { ({ rows, events } = saved); return { rows: [] }; }
  if (statement.startsWith("INSERT INTO opscenter_kernel.work_items")) {
    assert.match(statement, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
    const key = String(values[1]);
    if (rows.has(key)) return { rows: [] };
    const columns = ["id", "dedupe_key", "operating_date", "rule", "category", "severity", "entity_type", "entity_id", "entity_label", "title", "description", "source", "source_observed_at"];
    const row = { ...Object.fromEntries(columns.map((column, i) => [column, values[i]])), status: "open", version: 1, owner_actor_id: null, due_at: null, snoozed_until: null, resolution_code: null, resolution_note: null, resolved_at: null, first_detected_at: "2026-09-03T15:00:00Z", last_detected_at: "2026-09-03T15:00:00Z" };
    rows.set(key, row); return { rows: [structuredClone(row)] };
  }
  if (statement.startsWith("SELECT * FROM opscenter_kernel.work_items")) {
    assert.match(statement, /FOR UPDATE/);
    return { rows: rows.has(String(values[0])) ? [structuredClone(rows.get(String(values[0])))] : [] };
  }
  if (statement.startsWith("UPDATE opscenter_kernel.work_items")) {
    const row = [...rows.values()].find((item) => item.id === values[0]);
    assert.ok(row); row.status = values[1]; row.version = Number(row.version) + 1;
    if (values[1] === "in_progress") row.owner_actor_id ||= values[2];
    return { rows: [structuredClone(row)] };
  }
  if (statement.startsWith("INSERT INTO opscenter_kernel.events")) {
    if (failEvent) throw new Error("Test audit failure");
    events.push(values); return { rows: [] };
  }
  throw new Error(`Unexpected test query: ${statement}`);
};
const originalConnect = Pool.prototype.connect;
const originalEnvironment = { ...process.env };
Pool.prototype.connect = (async () => ({ query, release() {} })) as unknown as typeof Pool.prototype.connect;
process.env.OPSCENTER_KERNEL_ENABLED = "1";
process.env.OPS_RUNTIME = "MAC_MINI_PREVIEW";
for (const key of ["OPSCENTER_PREVIEW_DATABASE_URL", "OPSCENTER_MISSION_CONTROL_DATABASE_URL", "OPSCENTER_LIVE_DATABASE_URL", "OPSCENTER_VPS_DATABASE_URL"]) process.env[key] = "postgresql://invalid.invalid/isolated_preview_test";

async function main() {
  const input: DetectedWorkItemInput = { operatingDate: "2026-09-03", rule: COMMAND_ALERT_RULE, category: "Jobs", severity: "warning", entity: { type: "job", id: "example-channel:1", label: "JK4000001" }, title: "Example Appointment", description: "Source: /jobs#job-jk4000001", source: "Slack", sourceObservedAt: "2026-09-03T14:00:00Z" };
  const actor = { actorId: "example-operator", correlationId: "example-correlation" };
  const acknowledged = await saveCommandAlertWorkItem(input, { ...actor, action: "acknowledge", expectedVersion: 0 });
  assert.equal(commandAlertState(acknowledged), "acknowledged");
  assert.equal(acknowledged.ownerActorId, undefined);
  assert.equal(events.length, 1);
  const duplicate = await saveCommandAlertWorkItem(input, { ...actor, action: "acknowledge", expectedVersion: 0 });
  assert.equal(duplicate.id, acknowledged.id);
  assert.equal(events.length, 1, "Retries must not duplicate audit events");
  await assert.rejects(saveCommandAlertWorkItem(input, { ...actor, action: "add_to_control", expectedVersion: 0 }), /VERSION_CONFLICT/);
  assert.equal(rows.size, 1);
  const controlled = await saveCommandAlertWorkItem(input, { ...actor, action: "add_to_control", expectedVersion: acknowledged.version });
  assert.equal(commandAlertState(controlled), "in-control");
  assert.equal(controlled.ownerActorId, actor.actorId);
  assert.match(commandAlertControlHref(input.operatingDate, controlled.id), /commandView=control&action=.*#operating-inbox$/);
  await saveCommandAlertWorkItem(input, { actorId: "another-operator", correlationId: "retry", action: "add_to_control", expectedVersion: 0 });
  assert.equal([...rows.values()][0].owner_actor_id, actor.actorId, "A second click cannot steal ownership");
  assert.equal(events.length, 2);
  assert.equal(JSON.parse(String(events[1][10])).toStatus, "in_progress");
  [...rows.values()][0].status = "resolved";
  await assert.rejects(saveCommandAlertWorkItem(input, { ...actor, action: "add_to_control", expectedVersion: controlled.version }), /already resolved/);
  assert.equal(commandAlertState({ ...controlled, status: "resolved" }), "resolved");
  assert.equal(commandAlertState(), "active");
  failEvent = true;
  await assert.rejects(saveCommandAlertWorkItem({ ...input, entity: { ...input.entity, id: "example-channel:2" } }, { ...actor, action: "acknowledge", expectedVersion: 0 }), /audit failure/);
  assert.equal(rows.size, 1, "An audit failure must roll back the work item");
  console.log("Command alert persistence contract passed: acknowledgement, Control linkage, retries, conflicts, ownership, and audit rollback.");
}

main().finally(() => {
  Pool.prototype.connect = originalConnect;
  for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key];
  Object.assign(process.env, originalEnvironment);
}).catch((error) => { console.error(error); process.exitCode = 1; });
