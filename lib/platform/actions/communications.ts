import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executeInternalSlackNotice,
  verifyInternalSlackNotice,
  type InternalSlackNoticeInput,
} from "@/lib/communications-control";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function boundedText(value: unknown, label: string, minimum: number, maximum: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
  if (text.length < minimum) throw new Error(`${label} of at least ${minimum} characters is required.`);
  return text;
}

function rejectSensitiveMessage(values: string[]): void {
  const text = values.join(" ");
  const prohibited = [
    /xox[baprs]-[a-z0-9-]+/i,
    /\bbearer\s+[a-z0-9._-]+/i,
    /\b(?:password|secret|token)\s*[:=]\s*\S+/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/,
    /\b(?:\d[ -]*?){13,19}\b/,
  ];
  if (prohibited.some((pattern) => pattern.test(text))) {
    throw new Error("Internal Slack notices cannot contain credentials, customer contact details, or payment-card data.");
  }
}

export function validateInternalSlackNotice(value: unknown): InternalSlackNoticeInput {
  const input = record(value);
  const validated = {
    subject: boundedText(input.subject, "A Slack notice subject", 5, 80),
    message: boundedText(input.message, "A Slack notice message", 10, 800),
    owner: boundedText(input.owner, "A Slack notice owner", 2, 80),
    nextAction: boundedText(input.nextAction, "A Slack notice next action", 5, 200),
  };
  rejectSensitiveMessage(Object.values(validated));
  return validated;
}

export const communicationsActionDefinitions: ActionDefinition<any>[] = [
  {
    key: "communications.post_ops_command_notice.v1",
    version: 1,
    title: "Post internal Ops Command notice",
    riskClass: 2,
    supportedEntityTypes: ["platform"],
    requiredPermission: "operations.write",
    validateInput: validateInternalSlackNotice,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [
      entity.id,
      input.subject.toLowerCase(),
      input.message.toLowerCase(),
      input.owner.toLowerCase(),
      input.nextAction.toLowerCase(),
    ].join("|"),
    execute: async (context) => {
      if (context.entity.id !== "communications:ops-command") {
        throw new Error("Internal Slack notice entity mismatch.");
      }
      const receipt = await executeInternalSlackNotice(context.input, context.actionRunId);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (_context, result) => verifyInternalSlackNotice(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeInternalSlackNotice>>,
    ),
    retryableErrors: (error) => !/required|cannot contain|entity mismatch|not enabled|credential is unavailable|channel is invalid/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh Communications readiness, remove prohibited customer or credential data, and submit a new internal notice after Slack delivery is healthy.",
    emittedEventTypes: ["communications.ops_command_notice_requested.v1", "communications.ops_command_notice_verified.v1"],
  },
];
