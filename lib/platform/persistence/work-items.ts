import type { PoolClient } from "pg";
import type {
  EntityReference,
  WorkItem,
  WorkItemSeverity,
  WorkItemStatus,
} from "@/lib/platform/contracts";
import { createPlatformId, workItemDedupeKey } from "@/lib/platform/identifiers";
import { assertWorkItemTransition } from "@/lib/platform/state-machines";
import { appendPlatformEvent } from "@/lib/platform/persistence/events";
import { getKernelPool } from "@/lib/platform/persistence/pool";
import { withKernelTransaction } from "@/lib/platform/persistence/transaction";

export type DetectedWorkItemInput = {
  operatingDate: string;
  rule: string;
  category: WorkItem["category"];
  severity: WorkItemSeverity;
  entity: EntityReference;
  title: string;
  description: string;
  source: string;
  sourceObservedAt: string;
};

export type WorkItemReconciliationContext = {
  correlationId: string;
  actorId?: string;
  detectedAt?: string;
};

type WorkItemRow = {
  id: string;
  dedupe_key: string;
  operating_date: string;
  rule: string;
  category: WorkItem["category"];
  severity: WorkItemSeverity;
  entity_type: EntityReference["type"];
  entity_id: string;
  entity_label: string | null;
  title: string;
  description: string;
  source: string;
  source_observed_at: Date | string;
  status: WorkItemStatus;
  owner_actor_id: string | null;
  due_at: Date | string | null;
  snoozed_until: Date | string | null;
  resolution_code: string | null;
  resolution_note: string | null;
  first_detected_at: Date | string;
  last_detected_at: Date | string;
  resolved_at: Date | string | null;
  version: number;
};

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Platform timestamp is invalid.");
  return parsed.toISOString();
}

function optionalIso(value: Date | string | null): string | undefined {
  return value === null ? undefined : iso(value);
}

function workItemFromRow(row: WorkItemRow): WorkItem {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    operatingDate: String(row.operating_date),
    rule: row.rule,
    category: row.category,
    severity: row.severity,
    entity: {
      type: row.entity_type,
      id: row.entity_id,
      label: row.entity_label || undefined,
    },
    title: row.title,
    description: row.description,
    source: row.source,
    sourceObservedAt: iso(row.source_observed_at),
    status: row.status,
    ownerActorId: row.owner_actor_id || undefined,
    dueAt: optionalIso(row.due_at),
    snoozedUntil: optionalIso(row.snoozed_until),
    resolutionCode: row.resolution_code || undefined,
    resolutionNote: row.resolution_note || undefined,
    firstDetectedAt: iso(row.first_detected_at),
    lastDetectedAt: iso(row.last_detected_at),
    resolvedAt: optionalIso(row.resolved_at),
    version: row.version,
  };
}

async function selectByDedupeKey(client: PoolClient, dedupeKey: string): Promise<WorkItemRow | null> {
  const result = await client.query<WorkItemRow>(
    "SELECT * FROM opscenter_kernel.work_items WHERE dedupe_key = $1 FOR UPDATE",
    [dedupeKey],
  );
  return result.rows[0] || null;
}

export async function reconcileDetectedWorkItem(
  input: DetectedWorkItemInput,
  context: WorkItemReconciliationContext,
): Promise<{ workItem: WorkItem; outcome: "created" | "refreshed" | "reopened" }> {
  const dedupeKey = workItemDedupeKey({
    operatingDate: input.operatingDate,
    category: input.category,
    rule: input.rule,
    entityType: input.entity.type,
    entityId: input.entity.id,
  });
  const detectedAt = context.detectedAt || new Date().toISOString();

  return withKernelTransaction(async (client) => {
    const existing = await selectByDedupeKey(client, dedupeKey);
    const reopened = existing?.status === "resolved" || existing?.status === "dismissed";
    let result;

    if (!existing) {
      result = await client.query<WorkItemRow>(
        `
          INSERT INTO opscenter_kernel.work_items (
            id, dedupe_key, operating_date, rule, category, severity,
            entity_type, entity_id, entity_label, title, description, source,
            source_observed_at, status, first_detected_at, last_detected_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12,
            $13, 'open', $14, $14
          )
          RETURNING *
        `,
        [
          createPlatformId("work"), dedupeKey, input.operatingDate, input.rule,
          input.category, input.severity, input.entity.type, input.entity.id,
          input.entity.label || null, input.title, input.description, input.source,
          input.sourceObservedAt, detectedAt,
        ],
      );
    } else {
      result = await client.query<WorkItemRow>(
        `
          UPDATE opscenter_kernel.work_items
          SET severity = $2,
              entity_label = $3,
              title = $4,
              description = $5,
              source = $6,
              source_observed_at = $7,
              status = CASE WHEN status IN ('resolved', 'dismissed') THEN 'open' ELSE status END,
              resolution_code = CASE WHEN status IN ('resolved', 'dismissed') THEN NULL ELSE resolution_code END,
              resolution_note = CASE WHEN status IN ('resolved', 'dismissed') THEN NULL ELSE resolution_note END,
              resolved_at = CASE WHEN status IN ('resolved', 'dismissed') THEN NULL ELSE resolved_at END,
              last_detected_at = $8,
              last_absent_at = NULL,
              consecutive_fresh_absences = 0,
              version = version + CASE
                WHEN source_observed_at IS DISTINCT FROM $7::timestamptz
                  OR severity IS DISTINCT FROM $2
                  OR entity_label IS DISTINCT FROM $3
                  OR title IS DISTINCT FROM $4
                  OR description IS DISTINCT FROM $5
                  OR source IS DISTINCT FROM $6
                  OR status IN ('resolved', 'dismissed')
                THEN 1 ELSE 0 END,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [
          existing.id, input.severity, input.entity.label || null, input.title,
          input.description, input.source, input.sourceObservedAt, detectedAt,
        ],
      );
    }

    const workItem = workItemFromRow(result.rows[0]);
    const outcome = !existing ? "created" : reopened ? "reopened" : "refreshed";
    if (outcome !== "refreshed") {
      await appendPlatformEvent(client, {
        eventType: outcome === "created" ? "work.detected.v1" : "work.reopened.v1",
        eventVersion: 1,
        aggregateType: "work_item",
        aggregateId: workItem.id,
        actorId: context.actorId,
        occurredAt: detectedAt,
        correlationId: context.correlationId,
        payload: {
          dedupeKey: workItem.dedupeKey,
          operatingDate: workItem.operatingDate,
          rule: workItem.rule,
          category: workItem.category,
          severity: workItem.severity,
          entityType: workItem.entity.type,
          entityId: workItem.entity.id,
          source: workItem.source,
        },
      });
    }

    return { workItem, outcome };
  });
}

export async function getWorkItem(id: string): Promise<WorkItem | null> {
  const result = await getKernelPool().query<WorkItemRow>(
    "SELECT * FROM opscenter_kernel.work_items WHERE id = $1",
    [id],
  );
  return result.rows[0] ? workItemFromRow(result.rows[0]) : null;
}

export async function listWorkItems(input: {
  operatingDate?: string;
  statuses?: WorkItemStatus[];
  category?: WorkItem["category"];
  ownerActorId?: string;
  unassigned?: boolean;
  severity?: WorkItemSeverity;
  limit?: number;
} = {}): Promise<WorkItem[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (input.operatingDate) {
    values.push(input.operatingDate);
    conditions.push(`operating_date = $${values.length}`);
  }
  if (input.statuses?.length) {
    values.push(input.statuses);
    conditions.push(`status = ANY($${values.length}::text[])`);
  }
  if (input.category) {
    values.push(input.category);
    conditions.push(`category = $${values.length}`);
  }
  if (input.ownerActorId) {
    values.push(input.ownerActorId);
    conditions.push(`owner_actor_id = $${values.length}`);
  }
  if (input.unassigned) conditions.push("owner_actor_id IS NULL");
  if (input.severity) {
    values.push(input.severity);
    conditions.push(`severity = $${values.length}`);
  }
  const limit = Math.min(200, Math.max(1, Math.floor(input.limit || 100)));
  values.push(limit);

  const result = await getKernelPool().query<WorkItemRow>(
    `
      SELECT *
      FROM opscenter_kernel.work_items
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        last_detected_at DESC,
        id
      LIMIT $${values.length}
    `,
    values,
  );
  return result.rows.map(workItemFromRow);
}

export type WorkItemMutation =
  | { action: "acknowledge" }
  | { action: "assign_self" }
  | { action: "unassign" }
  | { action: "snooze"; until: string }
  | { action: "dismiss"; reason: string }
  | { action: "resolve_manually"; reason: string }
  | { action: "reopen" };

function requiredReason(value: string): string {
  const reason = String(value || "").trim();
  if (reason.length < 3) throw new Error("A reason of at least 3 characters is required.");
  return reason.slice(0, 1_000);
}

export async function mutateWorkItem(input: {
  id: string;
  expectedVersion: number;
  actorId: string;
  correlationId: string;
  mutation: WorkItemMutation;
}): Promise<WorkItem> {
  return withKernelTransaction(async (client) => {
    const selected = await client.query<WorkItemRow>(
      "SELECT * FROM opscenter_kernel.work_items WHERE id = $1 FOR UPDATE",
      [input.id],
    );
    const current = selected.rows[0];
    if (!current) throw new Error("Work item not found.");
    if (current.version !== input.expectedVersion) throw new Error("WORK_ITEM_VERSION_CONFLICT");

    let nextStatus = current.status;
    let ownerActorId = current.owner_actor_id;
    let snoozedUntil: string | null = current.snoozed_until ? iso(current.snoozed_until) : null;
    let resolutionCode = current.resolution_code;
    let resolutionNote = current.resolution_note;
    let resolvedAt: string | null = current.resolved_at ? iso(current.resolved_at) : null;
    const now = new Date().toISOString();

    switch (input.mutation.action) {
      case "acknowledge":
        nextStatus = "acknowledged";
        break;
      case "assign_self":
        ownerActorId = input.actorId;
        break;
      case "unassign":
        ownerActorId = null;
        break;
      case "snooze": {
        const until = new Date(input.mutation.until);
        if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
          throw new Error("Snooze time must be in the future.");
        }
        nextStatus = "snoozed";
        snoozedUntil = until.toISOString();
        break;
      }
      case "dismiss":
        nextStatus = "dismissed";
        resolutionCode = "operator_dismissed";
        resolutionNote = requiredReason(input.mutation.reason);
        resolvedAt = now;
        break;
      case "resolve_manually":
        nextStatus = "resolved";
        resolutionCode = "manual_resolution";
        resolutionNote = requiredReason(input.mutation.reason);
        resolvedAt = now;
        break;
      case "reopen":
        nextStatus = "open";
        resolutionCode = null;
        resolutionNote = null;
        resolvedAt = null;
        snoozedUntil = null;
        break;
    }

    assertWorkItemTransition(current.status, nextStatus);
    const result = await client.query<WorkItemRow>(
      `
        UPDATE opscenter_kernel.work_items
        SET status = $2, owner_actor_id = $3, snoozed_until = $4,
            resolution_code = $5, resolution_note = $6, resolved_at = $7,
            version = version + 1, updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [current.id, nextStatus, ownerActorId, snoozedUntil, resolutionCode, resolutionNote, resolvedAt],
    );
    const workItem = workItemFromRow(result.rows[0]);
    const eventTypeByAction: Record<WorkItemMutation["action"], string> = {
      acknowledge: "work.acknowledged.v1",
      assign_self: "work.assigned.v1",
      unassign: "work.assigned.v1",
      snooze: "work.snoozed.v1",
      dismiss: "work.dismissed.v1",
      resolve_manually: "work.resolved_manually.v1",
      reopen: "work.reopened.v1",
    };
    await appendPlatformEvent(client, {
      eventType: eventTypeByAction[input.mutation.action],
      eventVersion: 1,
      aggregateType: "work_item",
      aggregateId: workItem.id,
      actorId: input.actorId,
      occurredAt: now,
      correlationId: input.correlationId,
      payload: {
        fromStatus: current.status,
        toStatus: workItem.status,
        ownerActorId: workItem.ownerActorId || null,
        snoozedUntil: workItem.snoozedUntil || null,
        resolutionCode: workItem.resolutionCode || null,
        reason: workItem.resolutionNote || null,
        action: input.mutation.action,
        version: workItem.version,
      },
    });
    return workItem;
  });
}
