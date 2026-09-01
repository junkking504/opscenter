import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executeCustomerContactOutcome,
  executeCustomerContactPlan,
  verifyCustomerContactOutcome,
  verifyCustomerContactPlan,
  type CustomerContactOutcomeInput,
  type CustomerContactPlanInput,
} from "@/lib/customer-contact-control";
import type { CustomerContactChannel, CustomerContactOutcome } from "@/lib/customer-contact-store";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function bounded(value: unknown, label: string, minimum: number, maximum: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < minimum) throw new Error(`${label} of at least ${minimum} characters is required.`);
  return text.slice(0, maximum);
}

function identity(input: Record<string, unknown>) {
  const date = String(input.date || "").trim();
  const appointmentId = String(input.appointmentId || "").trim();
  const jobKey = String(input.jobKey || "").trim();
  const sourceObservedAt = String(input.sourceObservedAt || "").trim();
  const expectedObservationKey = String(input.expectedObservationKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid customer-contact date is required.");
  if (!/^\d{1,12}$/.test(appointmentId) || jobKey !== `appt:${appointmentId}`) throw new Error("A valid JunkWare appointment is required.");
  if (!Number.isFinite(Date.parse(sourceObservedAt))) throw new Error("A verified JunkWare schedule observation is required.");
  if (!/^[0-9a-f]{64}$/.test(expectedObservationKey)) throw new Error("The JunkWare contact observation is invalid.");
  return { date, appointmentId, jobKey, sourceObservedAt, expectedObservationKey };
}

function rejectUnsafeText(values: string[]): void {
  const text = values.join("\n");
  const prohibited = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/,
    /\b(?:password|secret|token|credential)\s*[:=]\s*\S+/i,
    /\bxox[baprs]-[a-z0-9-]+/i,
    /\b(?:\d[ -]*?){13,19}\b/,
  ];
  if (prohibited.some((pattern) => pattern.test(text))) {
    throw new Error("Customer-contact fields cannot contain contact details, credentials, or payment-card data.");
  }
}

export function validateCustomerContactPlan(value: unknown): CustomerContactPlanInput {
  const input = record(value);
  const base = identity(input);
  const channel = String(input.channel || "") as CustomerContactChannel;
  if (channel !== "phone" && channel !== "sms") throw new Error("Choose phone or SMS explicitly.");
  const purpose = bounded(input.purpose, "A customer-contact purpose", 5, 120);
  const owner = bounded(input.owner, "A customer-contact owner", 2, 120);
  const nextAction = bounded(input.nextAction, "A customer-contact next action", 5, 240);
  const message = channel === "sms" ? bounded(input.message, "An SMS draft", 10, 500) : "";
  rejectUnsafeText([purpose, owner, nextAction, message]);
  return {
    ...base,
    channel,
    purpose,
    message,
    owner,
    nextAction,
    expectedStoreUpdatedAt: String(input.expectedStoreUpdatedAt || "").trim(),
  };
}

export function validateCustomerContactOutcome(value: unknown): CustomerContactOutcomeInput {
  const input = record(value);
  const base = identity(input);
  const recordId = bounded(input.recordId, "An approved customer-contact record", 8, 120);
  const outcome = String(input.outcome || "") as CustomerContactOutcome;
  if (!["reached", "voicemail", "no_answer", "sms_sent", "sms_not_sent"].includes(outcome)) {
    throw new Error("Choose a valid customer-contact outcome.");
  }
  const evidenceNote = bounded(input.evidenceNote, "A customer-contact evidence note", 5, 1_000);
  rejectUnsafeText([evidenceNote]);
  return {
    ...base,
    recordId,
    outcome,
    evidenceNote,
    expectedStoreUpdatedAt: String(input.expectedStoreUpdatedAt || "").trim(),
    expectedRecordUpdatedAt: bounded(input.expectedRecordUpdatedAt, "The current contact record observation", 10, 40),
  };
}

function entityMatches(entityId: string, appointmentId: string): void {
  if (entityId !== `appointment:${appointmentId}`) throw new Error("Customer contact appointment identity mismatch.");
}

export const customerContactActionDefinitions: ActionDefinition<any>[] = [
  {
    key: "communications.approve_customer_contact.v1",
    version: 1,
    title: "Approve human-controlled customer contact",
    riskClass: 2,
    supportedEntityTypes: ["customer"],
    requiredPermission: "sensitive.write",
    validateInput: validateCustomerContactPlan,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [entity.id, input.expectedObservationKey, input.channel, input.purpose.toLowerCase(), input.message.toLowerCase(), input.owner.toLowerCase()].join("|"),
    execute: async (context) => {
      entityMatches(context.entity.id, context.input.appointmentId);
      const receipt = await executeCustomerContactPlan(context.input, context.actor.displayName, context.actionRunId);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifyCustomerContactPlan(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeCustomerContactPlan>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|invalid|identity mismatch|not present|contact number/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh Customer Contact, compare the current JunkWare appointment and phone observation, then submit a new bounded call or SMS draft if outreach is still needed.",
    emittedEventTypes: ["communications.customer_contact_requested.v1", "communications.customer_contact_plan_verified.v1"],
  },
  {
    key: "communications.record_customer_contact_outcome.v1",
    version: 1,
    title: "Record human-confirmed customer contact outcome",
    riskClass: 1,
    supportedEntityTypes: ["customer"],
    requiredPermission: "operations.write",
    validateInput: validateCustomerContactOutcome,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [entity.id, input.recordId, input.expectedRecordUpdatedAt, input.outcome].join("|"),
    execute: async (context) => {
      entityMatches(context.entity.id, context.input.appointmentId);
      const receipt = await executeCustomerContactOutcome(context.input, context.actor.displayName);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifyCustomerContactOutcome(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeCustomerContactOutcome>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|invalid|identity mismatch|unavailable|already has|prior JunkWare/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh Customer Contact and verify whether the approved plan already has an outcome or JunkWare note before recording a new human-confirmed result.",
    emittedEventTypes: ["communications.customer_contact_outcome_recorded.v1", "communications.customer_contact_junkware_note_verified.v1"],
  },
];
