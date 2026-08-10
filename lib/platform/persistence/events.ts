import type { PoolClient } from "pg";
import type { PlatformEvent } from "@/lib/platform/contracts";
import { createPlatformId } from "@/lib/platform/identifiers";
import { redactOperationalValue } from "@/lib/platform/redaction";
import { getKernelPool } from "@/lib/platform/persistence/pool";

type AppendEventInput = Omit<PlatformEvent, "id" | "recordedAt" | "payload"> & {
  id?: string;
  payload: Record<string, unknown>;
};

export async function appendPlatformEvent(
  client: PoolClient,
  input: AppendEventInput,
): Promise<PlatformEvent> {
  const event: PlatformEvent = {
    ...input,
    id: input.id || createPlatformId("event"),
    recordedAt: new Date().toISOString(),
    payload: redactOperationalValue(input.payload) as Record<string, unknown>,
  };

  await client.query(
    `
      INSERT INTO opscenter_kernel.events (
        id, event_type, event_version, aggregate_type, aggregate_id, actor_id,
        occurred_at, recorded_at, correlation_id, causation_id, payload_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    `,
    [
      event.id,
      event.eventType,
      event.eventVersion,
      event.aggregateType,
      event.aggregateId,
      event.actorId || null,
      event.occurredAt,
      event.recordedAt,
      event.correlationId,
      event.causationId || null,
      JSON.stringify(event.payload),
    ],
  );

  return event;
}

type EventRow = {
  id: string;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  actor_id: string | null;
  occurred_at: Date | string;
  recorded_at: Date | string;
  correlation_id: string;
  causation_id: string | null;
  payload_json: Record<string, unknown> | string;
};

export async function listPlatformEvents(aggregateType: string, aggregateId: string): Promise<PlatformEvent[]> {
  const result = await getKernelPool().query<EventRow>(
    `
      SELECT *
      FROM opscenter_kernel.events
      WHERE aggregate_type = $1 AND aggregate_id = $2
      ORDER BY recorded_at DESC, id DESC
      LIMIT 100
    `,
    [aggregateType, aggregateId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    actorId: row.actor_id || undefined,
    occurredAt: new Date(row.occurred_at).toISOString(),
    recordedAt: new Date(row.recorded_at).toISOString(),
    correlationId: row.correlation_id,
    causationId: row.causation_id || undefined,
    payload: typeof row.payload_json === "string" ? JSON.parse(row.payload_json) : row.payload_json,
  }));
}
