import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executeLinxupDeviceReview,
  normalizeLinxupControlTruck,
  verifyLinxupDeviceReview,
  type LinxupDeviceReviewInput,
} from "@/lib/linxup-control";
import { LINXUP_REVIEW_DISPOSITIONS, type LinxupReviewDisposition } from "@/lib/linxup-control-store";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function expectedObservation(input: Record<string, unknown>, key: string, label: string): string {
  if (!Object.prototype.hasOwnProperty.call(input, key)) throw new Error(`The current ${label} state is required.`);
  return String(input[key] || "").trim();
}

function rejectSensitiveNote(note: string): void {
  const prohibited = [
    /xox[baprs]-[a-z0-9-]+/i,
    /\bbearer\s+[a-z0-9._-]+/i,
    /\b(?:password|secret|token)\s*[:=]\s*\S+/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/,
  ];
  const paymentCard = Array.from(note.matchAll(/(?:\d[ -]?){13,19}/g)).some((match) => {
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
  if (paymentCard || prohibited.some((pattern) => pattern.test(note))) {
    throw new Error("LinxUp review notes cannot contain credentials, contact details, or payment-card data.");
  }
}

export function validateLinxupDeviceReview(value: unknown): LinxupDeviceReviewInput {
  const input = record(value);
  const date = String(input.date || "").trim();
  const truck = normalizeLinxupControlTruck(input.truck);
  const disposition = String(input.disposition || "").trim() as LinxupReviewDisposition;
  const note = String(input.note || "").replace(/\s+/g, " ").trim().slice(0, 1_000);
  const expectedObservationKey = expectedObservation(input, "expectedObservationKey", "LinxUp device evidence");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid LinxUp operating date is required.");
  if (!truck) throw new Error("A valid LinxUp truck is required.");
  if (!LINXUP_REVIEW_DISPOSITIONS.includes(disposition)) throw new Error("A valid LinxUp review disposition is required.");
  if (note.length < 5) throw new Error("A LinxUp review note of at least 5 characters is required.");
  rejectSensitiveNote(note);
  if (!/^[0-9a-f]{64}$/.test(expectedObservationKey)) throw new Error("The LinxUp device evidence observation is invalid.");
  return {
    date,
    truck,
    disposition,
    note,
    expectedStoreUpdatedAt: expectedObservation(input, "expectedStoreUpdatedAt", "LinxUp review"),
    expectedRecordUpdatedAt: expectedObservation(input, "expectedRecordUpdatedAt", "truck review"),
    expectedObservationKey,
  };
}

function entityMatchesTruck(entityId: string, truck: string): void {
  if (normalizeLinxupControlTruck(entityId) !== truck) throw new Error("LinxUp truck identity mismatch.");
}

export const linxupActionDefinitions: ActionDefinition<any>[] = [
  {
    key: "linxup.record_device_review.v1",
    version: 1,
    title: "Record LinxUp device review",
    riskClass: 2,
    supportedEntityTypes: ["truck"],
    requiredPermission: "operations.write",
    validateInput: validateLinxupDeviceReview,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [
      entity.id,
      input.expectedObservationKey,
      input.expectedRecordUpdatedAt || "new",
      input.disposition,
      input.note,
    ].join("|"),
    execute: async (context) => {
      entityMatchesTruck(context.entity.id, context.input.truck);
      const receipt = await executeLinxupDeviceReview(context.input, context.actor.displayName);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifyLinxupDeviceReview(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeLinxupDeviceReview>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|invalid|no longer available|identity mismatch/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh the LinxUp device snapshot, compare the current tracker and mapping evidence, then submit a new review disposition if follow-up is still required.",
    emittedEventTypes: ["linxup.device_review_requested.v1", "linxup.device_review_verified.v1"],
  },
];
