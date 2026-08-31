import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executeDispatchAssignment,
  executeDispatchCallAhead,
  normalizeDispatchTruck,
  verifyDispatchAssignment,
  verifyDispatchCallAhead,
  type DispatchAssignmentInput,
  type DispatchCallAheadInput,
} from "@/lib/dispatch-control";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function identity(input: Record<string, unknown>) {
  const date = String(input.date || "").trim();
  const appointmentId = String(input.appointmentId || "").trim();
  const jobKey = String(input.jobKey || "").trim();
  const sourceObservedAt = String(input.sourceObservedAt || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid dispatch date is required.");
  if (!/^\d{1,12}$/.test(appointmentId) || jobKey !== `appt:${appointmentId}`) throw new Error("A valid dispatch appointment is required.");
  if (!Number.isFinite(Date.parse(sourceObservedAt))) throw new Error("A verified schedule observation is required.");
  return { date, appointmentId, jobKey, sourceObservedAt };
}

export function validateDispatchAssignment(value: unknown): DispatchAssignmentInput {
  const input = record(value);
  const base = identity(input);
  const truck = normalizeDispatchTruck(input.truck);
  if (String(input.truck || "").trim() && !truck) throw new Error("A valid physical truck is required.");
  const expectedSourceTruck = normalizeDispatchTruck(input.expectedSourceTruck);
  return {
    ...base,
    truck,
    expectedSourceTruck,
    expectedRouteUpdatedAt: String(input.expectedRouteUpdatedAt || "").trim(),
  };
}

export function validateDispatchCallAhead(value: unknown): DispatchCallAheadInput {
  const input = record(value);
  const base = identity(input);
  const status = String(input.status || "").trim();
  const expectedStatus = String(input.expectedStatus || "").trim();
  if (status !== "called" && status !== "not_called") throw new Error("Choose called or not called.");
  if (expectedStatus && expectedStatus !== "called" && expectedStatus !== "not_called") throw new Error("The prior call-ahead status is invalid.");
  return { ...base, status, expectedStatus } as DispatchCallAheadInput;
}

export const dispatchActionDefinitions: ActionDefinition<any>[] = [
  {
    key: "dispatch.assign_truck.v1",
    version: 1,
    title: "Assign appointment to truck",
    riskClass: 2,
    supportedEntityTypes: ["job"],
    requiredPermission: "operations.write",
    validateInput: validateDispatchAssignment,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [
      entity.id,
      input.date,
      input.truck || "unassigned",
      input.expectedSourceTruck || "unassigned",
      input.expectedRouteUpdatedAt || "initial",
    ].join("|"),
    execute: async (context) => {
      const receipt = await executeDispatchAssignment(context.input);
      return {
        outcome: receipt.verified ? "completed" : "accepted",
        verificationAvailable: receipt.verified,
        metadata: { receipt },
      };
    },
    verify: async (context, result) => verifyDispatchAssignment(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeDispatchAssignment>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|invalid|rejected|not present|identity mismatch/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh the verified schedule and current assignment, then submit a new truck request if the dispatch intent is still valid.",
    emittedEventTypes: ["dispatch.assignment_requested.v1", "dispatch.assignment_verified.v1"],
  },
  {
    key: "dispatch.call_ahead.v1",
    version: 1,
    title: "Record call-ahead status",
    riskClass: 1,
    supportedEntityTypes: ["job"],
    requiredPermission: "operations.write",
    validateInput: validateDispatchCallAhead,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [entity.id, input.date, input.status, input.expectedStatus || "unset"].join("|"),
    execute: async (context) => {
      const receipt = executeDispatchCallAhead(context.input);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifyDispatchCallAhead(
      result.metadata?.receipt as ReturnType<typeof executeDispatchCallAhead>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|invalid|not present|identity mismatch/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh the appointment and confirm the current call-ahead state before trying again.",
    emittedEventTypes: ["dispatch.call_ahead_recorded.v1"],
  },
];
