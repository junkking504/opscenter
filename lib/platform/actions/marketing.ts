import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executePodiumReviewAttribution,
  verifyPodiumReviewAttribution,
  type PodiumAttributionMode,
  type PodiumReviewAttributionInput,
} from "@/lib/marketing-control";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function bounded(value: unknown, label: string, minimum: number, maximum: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
  if (text.length < minimum) throw new Error(`${label} is required.`);
  return text;
}

function timestamp(value: unknown, label: string, required: boolean): string {
  const text = String(value || "").trim();
  if (!text && !required) return "";
  if (!text || !Number.isFinite(Date.parse(text))) throw new Error(`A valid ${label} observation is required.`);
  return text;
}

function crew(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("The expected JunkWare crew is required.");
  const entries = value.map((entry) => String(entry || "").replace(/\s+/g, " ").trim().slice(0, 100)).filter(Boolean);
  if (!entries.length || entries.length > 12) throw new Error("A bounded expected JunkWare crew is required.");
  return Array.from(new Set(entries));
}

export function validatePodiumReviewAttribution(value: unknown): PodiumReviewAttributionInput {
  const input = record(value);
  const reviewUid = bounded(input.reviewUid, "A Podium review", 8, 100);
  const appointmentReference = bounded(input.appointmentReference, "A completed appointment reference", 1, 40);
  const assignmentMode = String(input.assignmentMode || "") as PodiumAttributionMode;
  const expectedCandidateKey = String(input.expectedCandidateKey || "").trim();
  if (!/^[a-z0-9-]+$/i.test(reviewUid)) throw new Error("A valid Podium review is required.");
  if (!/^[a-z0-9#-]+$/i.test(appointmentReference)) throw new Error("A valid completed appointment reference is required.");
  if (assignmentMode !== "confirm_suggestion" && assignmentMode !== "reassign") {
    throw new Error("Choose confirm suggestion or re-assign explicitly.");
  }
  if (!/^[0-9a-f]{64}$/.test(expectedCandidateKey)) throw new Error("The completed-job candidate observation is invalid.");
  return {
    reviewUid,
    appointmentReference,
    assignmentMode,
    expectedSnapshotFetchedAt: timestamp(input.expectedSnapshotFetchedAt, "Podium snapshot", true),
    expectedReviewUpdatedAt: timestamp(input.expectedReviewUpdatedAt, "Podium review", true),
    expectedAssignmentStoreUpdatedAt: timestamp(input.expectedAssignmentStoreUpdatedAt, "Podium assignment store", false),
    expectedAssignmentUpdatedAt: timestamp(input.expectedAssignmentUpdatedAt, "Podium assignment", false),
    expectedCandidateKey,
    expectedCandidateAppointmentId: bounded(input.expectedCandidateAppointmentId, "A candidate appointment", 1, 40),
    expectedCandidateJkNumber: bounded(input.expectedCandidateJkNumber, "A candidate JK number", 1, 40),
    expectedCandidateCrew: crew(input.expectedCandidateCrew),
  };
}

export const marketingActionDefinitions: ActionDefinition<any>[] = [{
  key: "marketing.assign_podium_review.v1",
  version: 1,
  title: "Assign Podium review to completed appointment",
  riskClass: 2,
  supportedEntityTypes: ["review"],
  requiredPermission: "sensitive.write",
  validateInput: validatePodiumReviewAttribution,
  redactInput: (input) => ({ ...input }),
  idempotencyKey: ({ entity, input }) => [
    entity.id,
    input.expectedSnapshotFetchedAt,
    input.expectedReviewUpdatedAt,
    input.expectedAssignmentUpdatedAt || "new",
    input.assignmentMode,
    input.expectedCandidateKey,
  ].join("|"),
  execute: async (context) => {
    if (context.entity.id !== context.input.reviewUid) throw new Error("Podium review identity mismatch.");
    const receipt = await executePodiumReviewAttribution(context.input, context.actor.displayName);
    return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
  },
  verify: async (context, result) => verifyPodiumReviewAttribution(
    result.metadata?.receipt as Awaited<ReturnType<typeof executePodiumReviewAttribution>>,
    context.input,
  ),
  retryableErrors: (error) => !/VERSION_CONFLICT|required|valid|identity mismatch|unavailable|no completed/i.test(error instanceof Error ? error.message : String(error)),
  recoveryGuidance: "Refresh Podium Reviews, confirm the candidate JK number and crew, then submit a new confirm-or-reassign request against the current review and completed-job evidence.",
  emittedEventTypes: ["marketing.podium_review_assignment_requested.v1", "marketing.podium_review_assignment_verified.v1"],
}];
