import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executeSearchKingsRecovery,
  verifySearchKingsRecovery,
  type SearchKingsRecoveryInput,
} from "@/lib/searchkings-control";
import type { LostLeadReason } from "@/lib/searchkings";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function bounded(value: unknown, label: string, minimum: number, maximum: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < minimum) throw new Error(`${label} of at least ${minimum} characters is required.`);
  return text.slice(0, maximum);
}

function timestamp(value: unknown, label: string): string {
  const text = String(value || "").trim();
  if (!text || !Number.isFinite(Date.parse(text))) throw new Error(`A valid ${label} observation is required.`);
  return text;
}

function rejectSensitiveText(values: string[]): void {
  const text = values.join("\n");
  const prohibited = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/,
    /\b(?:password|secret|token|credential)\s*[:=]\s*\S+/i,
    /\bxox[baprs]-[a-z0-9-]+/i,
  ];
  if (prohibited.some((pattern) => pattern.test(text))) {
    throw new Error("Lead recovery fields cannot contain customer contact details or credentials.");
  }
}

export function validateSearchKingsRecovery(value: unknown): SearchKingsRecoveryInput {
  const input = record(value);
  const date = String(input.date || "").trim();
  const callId = bounded(input.callId, "A SearchKings call", 4, 200);
  const status = String(input.status || "") as SearchKingsRecoveryInput["status"];
  const allowedReasons = ["", "availability", "pricing", "missed_call", "no_follow_up", "competitor", "out_of_area", "service_not_offered", "customer_declined", "other"];
  const reason = String(input.reason || "") as LostLeadReason;
  const owner = bounded(input.owner, "A recovery owner", 2, 120);
  const nextAction = bounded(input.nextAction, "A recovery next action", 5, 500);
  const evidenceNote = bounded(input.evidenceNote, "A recovery evidence note", 5, 1_000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid operating date is required.");
  if (!/^[a-z0-9-]+$/i.test(callId)) throw new Error("A valid SearchKings call is required.");
  if (!["needs_follow_up", "lost", "unqualified"].includes(status)) {
    throw new Error("Choose needs follow-up, lost, or unqualified. JunkWare evidence determines booked or recovered status.");
  }
  if (!allowedReasons.includes(reason)) throw new Error("A valid lead recovery reason is required.");
  if ((status === "lost" || status === "unqualified") && !reason) throw new Error("A reason is required for lost or unqualified leads.");
  if (input.franchiseContacted === true && evidenceNote.length < 10) {
    throw new Error("Contact confirmation requires evidence describing who verified it and when.");
  }
  const expectedObservationKey = String(input.expectedObservationKey || "").trim();
  if (!/^[0-9a-f]{64}$/.test(expectedObservationKey)) throw new Error("The SearchKings lead evidence observation is invalid.");
  rejectSensitiveText([owner, nextAction, evidenceNote]);
  return {
    date,
    callId,
    status,
    reason,
    owner,
    nextAction,
    evidenceNote,
    franchiseContacted: input.franchiseContacted === true,
    expectedSnapshotFetchedAt: timestamp(input.expectedSnapshotFetchedAt, "SearchKings source"),
    expectedStoreUpdatedAt: String(input.expectedStoreUpdatedAt || "").trim(),
    expectedOverrideUpdatedAt: String(input.expectedOverrideUpdatedAt || "").trim(),
    expectedObservationKey,
  };
}

export const searchKingsActionDefinitions: ActionDefinition<any>[] = [{
  key: "marketing.record_searchkings_recovery.v1",
  version: 1,
  title: "Record SearchKings lead recovery disposition",
  riskClass: 2,
  supportedEntityTypes: ["lead"],
  requiredPermission: "operations.write",
  validateInput: validateSearchKingsRecovery,
  redactInput: (input) => ({ ...input }),
  idempotencyKey: ({ entity, input }) => [
    entity.id,
    input.expectedSnapshotFetchedAt,
    input.expectedObservationKey,
    input.expectedOverrideUpdatedAt || "new",
    input.status,
    input.reason || "none",
    input.owner.toLowerCase(),
    input.nextAction.toLowerCase(),
  ].join("|"),
  execute: async (context) => {
    if (context.entity.id !== context.input.callId) throw new Error("SearchKings lead identity mismatch.");
    const receipt = await executeSearchKingsRecovery(context.input, context.actor.displayName);
    return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
  },
  verify: async (context, result) => verifySearchKingsRecovery(
    result.metadata?.receipt as Awaited<ReturnType<typeof executeSearchKingsRecovery>>,
    context.input,
  ),
  retryableErrors: (error) => !/VERSION_CONFLICT|required|valid|identity mismatch|no longer|current recovery queue/i.test(error instanceof Error ? error.message : String(error)),
  recoveryGuidance: "Refresh the SearchKings recovery pack, compare current call and JunkWare evidence, then submit a new disposition, owner, next action, and evidence note if recovery work remains.",
  emittedEventTypes: ["marketing.searchkings_recovery_requested.v1", "marketing.searchkings_recovery_verified.v1"],
}];
