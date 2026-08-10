import type { PoolClient } from "pg";
import type { PlatformEvent } from "@/lib/platform/contracts";
import { createPlatformId } from "@/lib/platform/identifiers";
import { redactOperationalValue } from "@/lib/platform/redaction";

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
