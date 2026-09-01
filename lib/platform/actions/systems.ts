import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executeSystemsIntegrationReview,
  verifySystemsIntegrationReview,
  type SystemsIntegrationReviewInput,
} from "@/lib/systems-control";
import {
  normalizeIntegrationId,
  SYSTEMS_REVIEW_DISPOSITIONS,
  type SystemsReviewDisposition,
} from "@/lib/systems-control-store";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function boundedText(value: unknown, label: string, minimum: number, maximum: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < minimum) throw new Error(`${label} of at least ${minimum} characters is required.`);
  return text.slice(0, maximum);
}

function expectedObservation(input: Record<string, unknown>, key: string, label: string): string {
  if (!Object.prototype.hasOwnProperty.call(input, key)) throw new Error(`The current ${label} state is required.`);
  return String(input[key] || "").trim();
}

function rejectSensitiveText(values: string[]): void {
  const text = values.join("\n");
  const prohibited = [
    /xox[baprs]-[a-z0-9-]+/i,
    /\bbearer\s+[a-z0-9._-]+/i,
    /\b(?:password|secret|token|credential)\s*[:=]\s*\S+/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/,
  ];
  const paymentCard = Array.from(text.matchAll(/(?:\d[ -]?){13,19}/g)).some((match) => {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let total = 0;
    let doubleDigit = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (doubleDigit) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      total += digit;
      doubleDigit = !doubleDigit;
    }
    return total % 10 === 0;
  });
  if (paymentCard || prohibited.some((pattern) => pattern.test(text))) {
    throw new Error("Systems review fields cannot contain credentials, contact details, or payment-card data.");
  }
}

export function validateSystemsIntegrationReview(value: unknown): SystemsIntegrationReviewInput {
  const input = record(value);
  const date = String(input.date || "").trim();
  const integrationId = normalizeIntegrationId(input.integrationId);
  const disposition = String(input.disposition || "").trim() as SystemsReviewDisposition;
  const owner = boundedText(input.owner, "A systems review owner", 2, 120);
  const nextAction = boundedText(input.nextAction, "A systems review next action", 5, 240);
  const note = boundedText(input.note, "A systems review evidence note", 5, 1_000);
  const expectedObservationKey = expectedObservation(input, "expectedObservationKey", "integration evidence");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid systems review date is required.");
  if (!integrationId) throw new Error("A valid integration is required.");
  if (!SYSTEMS_REVIEW_DISPOSITIONS.includes(disposition)) throw new Error("A valid systems review disposition is required.");
  if (!/^[0-9a-f]{64}$/.test(expectedObservationKey)) throw new Error("The systems integration evidence observation is invalid.");
  rejectSensitiveText([owner, nextAction, note]);
  return {
    date,
    integrationId,
    disposition,
    owner,
    nextAction,
    note,
    expectedReviewStoreUpdatedAt: expectedObservation(input, "expectedReviewStoreUpdatedAt", "systems review"),
    expectedReviewUpdatedAt: expectedObservation(input, "expectedReviewUpdatedAt", "integration review"),
    expectedObservationKey,
  };
}

function entityMatchesIntegration(entityId: string, integrationId: string): void {
  if (entityId !== `integration:${integrationId}`) throw new Error("Systems integration identity mismatch.");
}

export const systemsActionDefinitions: ActionDefinition<any>[] = [
  {
    key: "systems.record_integration_review.v1",
    version: 1,
    title: "Record integration recovery review",
    riskClass: 2,
    supportedEntityTypes: ["platform"],
    requiredPermission: "operations.write",
    validateInput: validateSystemsIntegrationReview,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [
      entity.id,
      input.expectedObservationKey,
      input.expectedReviewUpdatedAt || "new",
      input.disposition,
      input.owner.toLowerCase(),
      input.nextAction.toLowerCase(),
    ].join("|"),
    execute: async (context) => {
      entityMatchesIntegration(context.entity.id, context.input.integrationId);
      const receipt = await executeSystemsIntegrationReview(context.input, context.actor.displayName);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifySystemsIntegrationReview(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeSystemsIntegrationReview>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|invalid|no longer available|identity mismatch/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh Systems control, compare the current owning-source evidence, then submit a new owner, disposition, and bounded recovery step if follow-up is still required.",
    emittedEventTypes: ["systems.integration_review_requested.v1", "systems.integration_review_verified.v1"],
  },
];
