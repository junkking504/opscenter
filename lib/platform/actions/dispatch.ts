import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executeDispatchAssignment,
  executeDispatchCancellation,
  executeDispatchCallAhead,
  executeDispatchReschedule,
  normalizeDispatchTruck,
  verifyDispatchAssignment,
  verifyDispatchCancellation,
  verifyDispatchCallAhead,
  verifyDispatchReschedule,
  type DispatchAssignmentInput,
  type DispatchCancellationInput,
  type DispatchCallAheadInput,
  type DispatchRescheduleInput,
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

export function validateDispatchReschedule(value: unknown): DispatchRescheduleInput {
  const input = record(value);
  const base = identity(input);
  const appointmentStartMinutes = Number(input.appointmentStartMinutes);
  const durationHours = Number(input.durationHours);
  if (
    !Number.isInteger(appointmentStartMinutes)
    || appointmentStartMinutes < 0
    || appointmentStartMinutes >= 24 * 60
    || appointmentStartMinutes % 60 !== 0
  ) throw new Error("Choose a valid hourly appointment time.");
  if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 12 || appointmentStartMinutes + durationHours * 60 > 24 * 60) {
    throw new Error("Choose a valid appointment duration.");
  }
  const expectedAppointmentTime = String(input.expectedAppointmentTime || "").trim();
  if (!expectedAppointmentTime) throw new Error("The current appointment time is required.");
  return {
    ...base,
    appointmentStartMinutes,
    durationHours,
    expectedAppointmentTime,
    expectedEffectiveTruck: normalizeDispatchTruck(input.expectedEffectiveTruck),
    expectedRouteUpdatedAt: String(input.expectedRouteUpdatedAt || "").trim(),
  };
}

export function validateDispatchCancellation(value: unknown): DispatchCancellationInput {
  const input = record(value);
  const base = identity(input);
  const cancellationReason = String(input.cancellationReason || "").trim().slice(0, 500);
  if (cancellationReason.length < 3) throw new Error("A cancellation reason of at least 3 characters is required.");
  const expectedStatus = String(input.expectedStatus || "").trim();
  const expectedAppointmentTime = String(input.expectedAppointmentTime || "").trim();
  if (!expectedStatus || !expectedAppointmentTime) throw new Error("The current appointment state is required.");
  return {
    ...base,
    cancellationReason,
    expectedStatus,
    expectedAppointmentTime,
    expectedRouteUpdatedAt: String(input.expectedRouteUpdatedAt || "").trim(),
  };
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
  {
    key: "dispatch.reschedule_time.v1",
    version: 1,
    title: "Reschedule appointment time",
    riskClass: 2,
    supportedEntityTypes: ["job"],
    requiredPermission: "operations.write",
    validateInput: validateDispatchReschedule,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [
      entity.id,
      input.date,
      input.appointmentStartMinutes,
      input.durationHours,
      input.expectedAppointmentTime,
      input.expectedRouteUpdatedAt || "initial",
    ].join("|"),
    execute: async (context) => {
      const receipt = await executeDispatchReschedule(context.input);
      return {
        outcome: receipt.verified ? "completed" : "accepted",
        verificationAvailable: receipt.verified,
        metadata: { receipt },
      };
    },
    verify: async (context, result) => verifyDispatchReschedule(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeDispatchReschedule>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|valid|rejected|not present|identity mismatch/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh the verified appointment time and submit a new request if the same-day reschedule is still needed.",
    emittedEventTypes: ["dispatch.reschedule_requested.v1", "dispatch.reschedule_verified.v1"],
  },
  {
    key: "dispatch.cancel_appointment.v1",
    version: 1,
    title: "Cancel appointment",
    riskClass: 3,
    supportedEntityTypes: ["job"],
    requiredPermission: "operations.write",
    validateInput: validateDispatchCancellation,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [
      entity.id,
      input.date,
      input.expectedStatus,
      input.expectedAppointmentTime,
      input.expectedRouteUpdatedAt || "initial",
      input.cancellationReason,
    ].join("|"),
    execute: async (context) => {
      const receipt = await executeDispatchCancellation(context.input);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifyDispatchCancellation(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeDispatchCancellation>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|completed|rejected|not present|identity mismatch/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh the verified appointment. If it is still active, review the reason and submit a new cancellation request.",
    emittedEventTypes: ["dispatch.cancellation_requested.v1", "dispatch.cancellation_verified.v1"],
  },
];
