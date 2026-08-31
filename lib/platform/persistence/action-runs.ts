import type { PoolClient } from "pg";
import type {
  ActionRun,
  ActionRunStatus,
  ActionVerification,
  EntityReference,
  PlatformActor,
  PolicyDecision,
} from "@/lib/platform/contracts";
import { createPlatformId } from "@/lib/platform/identifiers";
import { appendPlatformEvent } from "@/lib/platform/persistence/events";
import { getKernelPool } from "@/lib/platform/persistence/pool";
import { withKernelTransaction } from "@/lib/platform/persistence/transaction";
import { assertActionRunTransition } from "@/lib/platform/state-machines";

type ActionRunRow = {
  id: string;
  action_key: string;
  action_version: number;
  risk_class: ActionRun["riskClass"];
  actor_id: string;
  entity_type: EntityReference["type"];
  entity_id: string;
  work_item_id: string | null;
  idempotency_key: string;
  input_json: Record<string, unknown> | string;
  status: ActionRunStatus;
  policy_decision_json: PolicyDecision | string;
  requested_at: Date | string;
  approved_at: Date | string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  verification_json: ActionVerification | string | null;
  sanitized_error: string | null;
  correlation_id: string;
};

function json<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function optionalIso(value: Date | string | null): string | undefined {
  return value == null ? undefined : iso(value);
}

function actionRunFromRow(row: ActionRunRow): ActionRun {
  return {
    id: row.id,
    actionKey: row.action_key,
    actionVersion: row.action_version,
    riskClass: row.risk_class,
    actorId: row.actor_id,
    entity: { type: row.entity_type, id: row.entity_id },
    workItemId: row.work_item_id || undefined,
    idempotencyKey: row.idempotency_key,
    input: json(row.input_json),
    status: row.status,
    policyDecision: json(row.policy_decision_json),
    requestedAt: iso(row.requested_at),
    approvedAt: optionalIso(row.approved_at),
    startedAt: optionalIso(row.started_at),
    finishedAt: optionalIso(row.finished_at),
    verification: row.verification_json ? json(row.verification_json) : undefined,
    sanitizedError: row.sanitized_error || undefined,
    correlationId: row.correlation_id,
  };
}

async function selectActionRun(client: PoolClient, id: string, lock = false): Promise<ActionRunRow | null> {
  const result = await client.query<ActionRunRow>(
    `SELECT * FROM opscenter_kernel.action_runs WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return result.rows[0] || null;
}

export async function createPersistedActionRun(input: {
  actionKey: string;
  actionVersion: number;
  riskClass: ActionRun["riskClass"];
  actor: PlatformActor;
  entity: EntityReference;
  workItemId?: string;
  idempotencyKey: string;
  storedInput: Record<string, unknown>;
  status: Extract<ActionRunStatus, "awaiting_approval" | "denied" | "queued">;
  policyDecision: PolicyDecision;
  requestedFromRole?: "manager" | "admin";
  correlationId: string;
}): Promise<{ run: ActionRun; created: boolean }> {
  return withKernelTransaction(async (client) => {
    const id = createPlatformId("action");
    const requestedAt = new Date().toISOString();
    const inserted = await client.query<ActionRunRow>(
      `
        INSERT INTO opscenter_kernel.action_runs (
          id, action_key, action_version, risk_class, actor_id,
          entity_type, entity_id, work_item_id, idempotency_key, input_json,
          status, policy_decision_json, requested_at, correlation_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb, $13, $14)
        ON CONFLICT (action_key, idempotency_key) DO NOTHING
        RETURNING *
      `,
      [
        id,
        input.actionKey,
        input.actionVersion,
        input.riskClass,
        input.actor.id,
        input.entity.type,
        input.entity.id,
        input.workItemId || null,
        input.idempotencyKey,
        JSON.stringify(input.storedInput),
        input.status,
        JSON.stringify(input.policyDecision),
        requestedAt,
        input.correlationId,
      ],
    );

    if (!inserted.rows[0]) {
      const existing = await client.query<ActionRunRow>(
        "SELECT * FROM opscenter_kernel.action_runs WHERE action_key = $1 AND idempotency_key = $2",
        [input.actionKey, input.idempotencyKey],
      );
      if (!existing.rows[0]) throw new Error("Action idempotency lookup failed.");
      return { run: actionRunFromRow(existing.rows[0]), created: false };
    }

    if (input.status === "awaiting_approval") {
      await client.query(
        `
          INSERT INTO opscenter_kernel.approvals (
            id, action_run_id, requested_from_role, decision, requested_at
          ) VALUES ($1, $2, $3, 'pending', $4)
        `,
        [createPlatformId("approval"), id, input.requestedFromRole || "manager", requestedAt],
      );
    }

    await appendPlatformEvent(client, {
      eventType: "action.requested.v1",
      eventVersion: 1,
      aggregateType: "action_run",
      aggregateId: id,
      actorId: input.actor.id,
      occurredAt: requestedAt,
      correlationId: input.correlationId,
      payload: {
        actionKey: input.actionKey,
        riskClass: input.riskClass,
        entityType: input.entity.type,
        entityId: input.entity.id,
        workItemId: input.workItemId || null,
        status: input.status,
        policyOutcome: input.policyDecision.outcome,
      },
    });

    return { run: actionRunFromRow(inserted.rows[0]), created: true };
  });
}

export async function transitionPersistedActionRun(input: {
  id: string;
  nextStatus: ActionRunStatus;
  eventType: string;
  actorId?: string;
  verification?: ActionVerification;
  sanitizedError?: string;
}): Promise<ActionRun> {
  return withKernelTransaction(async (client) => {
    const current = await selectActionRun(client, input.id, true);
    if (!current) throw new Error("Action run not found.");
    assertActionRunTransition(current.status, input.nextStatus);
    const now = new Date().toISOString();
    const approvedAt = current.approved_at || (current.status === "awaiting_approval" && input.nextStatus === "queued" ? now : null);
    const startedAt = current.started_at || (input.nextStatus === "running" ? now : null);
    const finishedAt = ["succeeded", "failed", "denied", "cancelled"].includes(input.nextStatus)
      ? now
      : current.finished_at;
    const result = await client.query<ActionRunRow>(
      `
        UPDATE opscenter_kernel.action_runs
        SET status = $2,
            approved_at = $3,
            started_at = $4,
            finished_at = $5,
            verification_json = COALESCE($6::jsonb, verification_json),
            sanitized_error = $7,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        current.id,
        input.nextStatus,
        approvedAt,
        startedAt,
        finishedAt,
        input.verification ? JSON.stringify(input.verification) : null,
        input.sanitizedError || null,
      ],
    );
    await appendPlatformEvent(client, {
      eventType: input.eventType,
      eventVersion: 1,
      aggregateType: "action_run",
      aggregateId: current.id,
      actorId: input.actorId,
      occurredAt: now,
      correlationId: current.correlation_id,
      payload: {
        actionKey: current.action_key,
        fromStatus: current.status,
        toStatus: input.nextStatus,
        verificationOutcome: input.verification?.outcome || null,
        failed: input.nextStatus === "failed",
      },
    });
    return actionRunFromRow(result.rows[0]);
  });
}

export async function decidePersistedApproval(input: {
  actionRunId: string;
  decision: "approved" | "denied";
  actorId: string;
  reason: string;
}): Promise<ActionRun> {
  return withKernelTransaction(async (client) => {
    const current = await selectActionRun(client, input.actionRunId, true);
    if (!current) throw new Error("Action run not found.");
    if (current.status !== "awaiting_approval") throw new Error("Action run is not awaiting approval.");
    const approval = await client.query<{ id: string }>(
      `
        SELECT id FROM opscenter_kernel.approvals
        WHERE action_run_id = $1 AND decision = 'pending'
        ORDER BY requested_at, id
        LIMIT 1
        FOR UPDATE
      `,
      [current.id],
    );
    if (!approval.rows[0]) throw new Error("Pending approval not found.");
    const now = new Date().toISOString();
    await client.query(
      `
        UPDATE opscenter_kernel.approvals
        SET decision = $2, decided_by_actor_id = $3, reason = $4, decided_at = $5
        WHERE id = $1
      `,
      [approval.rows[0].id, input.decision, input.actorId, input.reason || null, now],
    );
    const nextStatus: ActionRunStatus = input.decision === "approved" ? "queued" : "denied";
    assertActionRunTransition(current.status, nextStatus);
    const updated = await client.query<ActionRunRow>(
      `
        UPDATE opscenter_kernel.action_runs
        SET status = $2,
            approved_at = CASE WHEN $2 = 'queued' THEN $3::timestamptz ELSE approved_at END,
            finished_at = CASE WHEN $2 = 'denied' THEN $3::timestamptz ELSE finished_at END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [current.id, nextStatus, now],
    );
    await appendPlatformEvent(client, {
      eventType: input.decision === "approved" ? "action.approved.v1" : "action.denied.v1",
      eventVersion: 1,
      aggregateType: "action_run",
      aggregateId: current.id,
      actorId: input.actorId,
      occurredAt: now,
      correlationId: current.correlation_id,
      payload: { actionKey: current.action_key, decision: input.decision, reason: input.reason || null },
    });
    return actionRunFromRow(updated.rows[0]);
  });
}

export async function getActionRun(id: string): Promise<ActionRun | null> {
  const result = await getKernelPool().query<ActionRunRow>(
    "SELECT * FROM opscenter_kernel.action_runs WHERE id = $1",
    [id],
  );
  return result.rows[0] ? actionRunFromRow(result.rows[0]) : null;
}

export async function listActionRuns(input: { limit?: number; workItemId?: string } = {}): Promise<ActionRun[]> {
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 30));
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (input.workItemId) {
    values.push(input.workItemId);
    conditions.push(`work_item_id = $${values.length}`);
  }
  values.push(limit);
  const result = await getKernelPool().query<ActionRunRow>(
    `
      SELECT * FROM opscenter_kernel.action_runs
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY requested_at DESC, id DESC
      LIMIT $${values.length}
    `,
    values,
  );
  return result.rows.map(actionRunFromRow);
}
