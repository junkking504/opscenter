import type { OperationalException, OperationalExceptionsReport } from "@/lib/operational-exceptions";
import { buildOperationalExceptions } from "@/lib/operational-exceptions";
import type { PlatformActor, PlatformEvent, WorkItem, WorkItemStatus } from "@/lib/platform/contracts";
import { createCorrelationId, createPlatformId, workItemDedupeKey } from "@/lib/platform/identifiers";
import { actorDisplayNames } from "@/lib/platform/persistence/actors";
import { appendPlatformEvent, listPlatformEvents } from "@/lib/platform/persistence/events";
import { getKernelPool } from "@/lib/platform/persistence/pool";
import { withKernelTransaction } from "@/lib/platform/persistence/transaction";
import { listWorkItems, reconcileDetectedWorkItem } from "@/lib/platform/persistence/work-items";

export const INBOX_RULES = new Set([
  "completed_job_with_no_driver",
  "completed_job_with_no_navigator",
  "completed_job_assigned_to_virtual_truck",
  "job_with_revenue_but_no_credited_crew",
  "payment_amount_present_but_payment_type_missing",
  "completed_job_with_no_closeout_photos",
  "whatsapp_job_photo_needs_review",
]);

export type InboxWorkItem = WorkItem & {
  ownerDisplayName?: string;
  href?: string;
};

export type InboxEvent = PlatformEvent & {
  actorDisplayName?: string;
};

export type InboxPayload = {
  date: string;
  actor: Pick<PlatformActor, "id" | "displayName">;
  items: InboxWorkItem[];
  counts: {
    active: number;
    mine: number;
    unassigned: number;
    resolved: number;
  };
};

function safeIso(value: string, fallback: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function todayChicago(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function chicagoDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function sourceIsFresh(report: OperationalExceptionsReport): boolean {
  const observed = new Date(report.asOf);
  if (Number.isNaN(observed.getTime())) return false;
  if (report.date !== todayChicago()) return chicagoDate(report.asOf) === report.date;
  const ageMs = Date.now() - observed.getTime();
  return ageMs >= -10 * 60_000 && ageMs <= 6 * 60 * 60_000;
}

function detectedInput(exception: OperationalException, report: OperationalExceptionsReport) {
  return {
    operatingDate: report.date,
    rule: exception.rule,
    category: exception.category,
    severity: exception.severity,
    entity: {
      type: exception.entityType,
      id: exception.entityId,
      label: exception.entityLabel,
    },
    title: exception.title,
    description: exception.reason,
    source: exception.source,
    sourceObservedAt: safeIso(exception.timestamp, safeIso(report.asOf, new Date().toISOString())),
  };
}

function workItemHref(item: WorkItem): string | undefined {
  if (item.entity.type === "job") {
    const anchor = String(item.entity.label || item.entity.id)
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
    return `/jobs?date=${encodeURIComponent(item.operatingDate)}${anchor ? `#job-${anchor}` : ""}`;
  }
  if (item.entity.type === "employee") return `/crew/${encodeURIComponent(item.entity.id)}?date=${item.operatingDate}`;
  if (item.entity.type === "truck") return `/fleet?date=${item.operatingDate}&truck=${encodeURIComponent(item.entity.id)}`;
  if (item.entity.type === "finance") return `/finance?date=${item.operatingDate}`;
  return undefined;
}

async function recordAbsences(input: {
  runId: string;
  report: OperationalExceptionsReport;
  actorId: string;
  correlationId: string;
  detectedDedupeKeys: Set<string>;
  sourceFresh: boolean;
}): Promise<void> {
  await withKernelTransaction(async (client) => {
    const previous = await client.query<{ source_observed_at: Date | string | null }>(
      `
        SELECT source_observed_at
        FROM opscenter_kernel.detector_runs
        WHERE detector_key = 'operating_inbox.v1'
          AND operating_date = $1
          AND status = 'succeeded'
          AND id <> $2
        ORDER BY finished_at DESC NULLS LAST, started_at DESC
        LIMIT 1
      `,
      [input.report.date, input.runId],
    );
    const observedAt = safeIso(input.report.asOf, new Date().toISOString());
    const previousObservedAt = previous.rows[0]?.source_observed_at
      ? new Date(previous.rows[0].source_observed_at).toISOString()
      : null;
    const advancesAbsence = input.sourceFresh && previousObservedAt !== observedAt;

    const active = await client.query<{
      id: string;
      dedupe_key: string;
      status: WorkItemStatus;
      consecutive_fresh_absences: number;
      version: number;
    }>(
      `
        SELECT id, dedupe_key, status, consecutive_fresh_absences, version
        FROM opscenter_kernel.work_items
        WHERE operating_date = $1
          AND rule = ANY($2::text[])
          AND status NOT IN ('resolved', 'dismissed')
        FOR UPDATE
      `,
      [input.report.date, Array.from(INBOX_RULES)],
    );

    for (const row of active.rows) {
      if (input.detectedDedupeKeys.has(row.dedupe_key) || !advancesAbsence) continue;
      const absences = row.consecutive_fresh_absences + 1;
      const resolves = absences >= 2;
      await client.query(
        `
          UPDATE opscenter_kernel.work_items
          SET last_absent_at = now(), consecutive_fresh_absences = $2,
              status = CASE WHEN $3 THEN 'resolved' ELSE status END,
              resolution_code = CASE WHEN $3 THEN 'source_condition_cleared' ELSE resolution_code END,
              resolution_note = CASE WHEN $3 THEN 'Resolved after two distinct fresh-source observations cleared the condition.' ELSE resolution_note END,
              resolved_at = CASE WHEN $3 THEN now() ELSE resolved_at END,
              version = version + 1, updated_at = now()
          WHERE id = $1
        `,
        [row.id, absences, resolves],
      );
      if (resolves) {
        await appendPlatformEvent(client, {
          eventType: "work.resolved.v1",
          eventVersion: 1,
          aggregateType: "work_item",
          aggregateId: row.id,
          actorId: input.actorId,
          occurredAt: new Date().toISOString(),
          correlationId: input.correlationId,
          payload: { resolutionCode: "source_condition_cleared", freshAbsenceCount: absences },
        });
      }
    }

    await client.query(
      `
        UPDATE opscenter_kernel.detector_runs
        SET status = 'succeeded', detected_count = $2, finished_at = now()
        WHERE id = $1
      `,
      [input.runId, input.detectedDedupeKeys.size],
    );
  });
}

export async function reconcileOperatingInbox(date: string, actorId: string): Promise<{
  detected: number;
  created: number;
  reopened: number;
  sourceFresh: boolean;
  sourceObservedAt: string;
}> {
  const report = buildOperationalExceptions(date);
  const supported = report.exceptions.filter((exception) => INBOX_RULES.has(exception.rule));
  const sourceFresh = sourceIsFresh(report);
  const sourceObservedAt = safeIso(report.asOf, new Date().toISOString());
  const runId = createPlatformId("detector");
  const correlationId = createCorrelationId();
  await getKernelPool().query(
    `
      INSERT INTO opscenter_kernel.detector_runs (
        id, detector_key, operating_date, source_observed_at, source_fresh, status, started_at
      ) VALUES ($1, 'operating_inbox.v1', $2, $3, $4, 'running', now())
    `,
    [runId, report.date, sourceObservedAt, sourceFresh],
  );

  const detectedDedupeKeys = new Set<string>();
  let created = 0;
  let reopened = 0;
  try {
    for (const exception of supported) {
      const detected = detectedInput(exception, report);
      detectedDedupeKeys.add(workItemDedupeKey({
        operatingDate: detected.operatingDate,
        category: detected.category,
        rule: detected.rule,
        entityType: detected.entity.type,
        entityId: detected.entity.id,
      }));
      const result = await reconcileDetectedWorkItem(detected, { correlationId, actorId });
      if (result.outcome === "created") created += 1;
      if (result.outcome === "reopened") reopened += 1;
    }
    await recordAbsences({ runId, report, actorId, correlationId, detectedDedupeKeys, sourceFresh });
  } catch (error) {
    await getKernelPool().query(
      `UPDATE opscenter_kernel.detector_runs SET status = 'failed', finished_at = now(), sanitized_error = $2 WHERE id = $1`,
      [runId, error instanceof Error ? error.message.slice(0, 500) : "Unknown reconciliation failure"],
    ).catch(() => undefined);
    throw error;
  }

  return { detected: supported.length, created, reopened, sourceFresh, sourceObservedAt };
}

export async function buildInboxPayload(date: string, actor: PlatformActor): Promise<InboxPayload> {
  const items = await listWorkItems({ operatingDate: date, limit: 200 });
  const names = await actorDisplayNames(items.flatMap((item) => item.ownerActorId ? [item.ownerActorId] : []));
  const enriched = items.map((item) => ({
    ...item,
    ownerDisplayName: item.ownerActorId ? names.get(item.ownerActorId) : undefined,
    href: workItemHref(item),
  }));
  const activeStatuses: WorkItemStatus[] = ["open", "acknowledged", "in_progress", "snoozed"];
  return {
    date,
    actor: { id: actor.id, displayName: actor.displayName },
    items: enriched,
    counts: {
      active: enriched.filter((item) => activeStatuses.includes(item.status)).length,
      mine: enriched.filter((item) => activeStatuses.includes(item.status) && item.ownerActorId === actor.id).length,
      unassigned: enriched.filter((item) => activeStatuses.includes(item.status) && !item.ownerActorId).length,
      resolved: enriched.filter((item) => item.status === "resolved" || item.status === "dismissed").length,
    },
  };
}

export async function workItemHistory(id: string): Promise<InboxEvent[]> {
  const events = await listPlatformEvents("work_item", id);
  const names = await actorDisplayNames(events.flatMap((event) => event.actorId ? [event.actorId] : []));
  return events.map((event) => ({
    ...event,
    actorDisplayName: event.actorId ? names.get(event.actorId) : undefined,
  }));
}
