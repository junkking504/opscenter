import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Pool } from "pg";
import { COMMAND_ALERT_RULE } from "../lib/command-alert-workflow";
import { resolveKernelDatabaseConfig } from "../lib/platform/persistence/config";
import { getKernelPool } from "../lib/platform/persistence/pool";
import { ensureHumanOperator } from "../lib/platform/persistence/actors";
import { mutateWorkItem, saveCommandAlertWorkItem, type DetectedWorkItemInput } from "../lib/platform/persistence/work-items";

async function main() {
  const config = resolveKernelDatabaseConfig();
  assert.ok(config.status === "ready" && config.runtime === "MAC_MINI_PREVIEW" && config.databaseName.includes("preview"), "This test is allowed only against an isolated preview database");
  const pool = getKernelPool();
  const runId = crypto.randomUUID();
  const actorIds: string[] = [];
  const entityId = `database-verification:${runId}`;
  const input: DetectedWorkItemInput = {
    operatingDate: "2080-01-01", rule: COMMAND_ALERT_RULE, category: "Jobs", severity: "info",
    entity: { type: "job", id: entityId, label: "ISOLATED DATABASE TEST" },
    title: "Database verification - not operational", description: "Synthetic test; no external source or customer action.",
    source: "Isolated database test", sourceObservedAt: new Date().toISOString(),
  };
  try {
    for (const name of ["a", "b"]) actorIds.push((await ensureHumanOperator(`qa.${name}.${runId}@example.invalid`)).id);
    const [first, second] = await Promise.all(actorIds.map((actorId) => saveCommandAlertWorkItem(input, {
      actorId, correlationId: runId, action: "add_to_control", expectedVersion: 0,
    })));
    assert.equal(first.id, second.id, "Simultaneous operators must create only one Control record");
    assert.equal(first.ownerActorId, second.ownerActorId, "The second click must not replace ownership");
    assert.equal(first.status, "in_progress");
    const events = await pool.query("SELECT event_type, actor_id FROM opscenter_kernel.events WHERE aggregate_id=$1", [first.id]);
    assert.equal(events.rowCount, 1, "Concurrent retries must not duplicate the audit event");
    assert.equal(events.rows[0].actor_id, first.ownerActorId);
    const independent = new Pool({ connectionString: config.connectionString, max: 1 });
    try {
      const readBack = await independent.query("SELECT status, owner_actor_id, version FROM opscenter_kernel.work_items WHERE id=$1", [first.id]);
      assert.equal(readBack.rows[0].status, "in_progress");
      assert.equal(readBack.rows[0].owner_actor_id, first.ownerActorId);
    } finally { await independent.end(); }
    await assert.rejects(mutateWorkItem({ id: first.id, actorId: actorIds[1], correlationId: runId, expectedVersion: 1, mutation: { action: "resolve_manually", reason: "Synthetic test result verified" } }), /VERSION_CONFLICT/);
    const resolved = await mutateWorkItem({ id: first.id, actorId: actorIds[0], correlationId: runId, expectedVersion: first.version, mutation: { action: "resolve_manually", reason: "Synthetic test result verified; no business action" } });
    assert.equal(resolved.status, "resolved");
    await assert.rejects(saveCommandAlertWorkItem(input, { actorId: actorIds[1], correlationId: runId, action: "add_to_control", expectedVersion: resolved.version }), /already resolved/);
    console.log("Real preview database passed: simultaneous operators, single ownership, independent-session read-back, audit attribution, conflict rejection, and explicit resolution.");
  } finally {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM opscenter_kernel.events WHERE aggregate_id IN (SELECT id FROM opscenter_kernel.work_items WHERE entity_id=$1 AND source='Isolated database test')", [entityId]);
      await client.query("DELETE FROM opscenter_kernel.work_items WHERE entity_id=$1 AND source='Isolated database test'", [entityId]);
      await client.query("DELETE FROM opscenter_kernel.actor_roles WHERE actor_id = ANY($1::text[])", [actorIds]);
      await client.query("DELETE FROM opscenter_kernel.actors WHERE id = ANY($1::text[])", [actorIds]);
      await client.query("COMMIT");
      console.log("Removed only this run's synthetic preview records and test identities.");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); await pool.end(); }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
