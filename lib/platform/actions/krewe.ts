import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executeKreweAvailability,
  executeKreweScheduleCallIn,
  verifyKreweAvailability,
  verifyKreweScheduleCallIn,
  type KreweAvailabilityInput,
  type KreweScheduleCallInInput,
} from "@/lib/krewe-control";
import { normalizeEmployeeKey } from "@/lib/manual-bonuses";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function dateKey(value: unknown, label: string): string {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`A valid ${label} is required.`);
  return date;
}

function nextDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function employeeName(value: unknown): string {
  const name = String(value || "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (name.length < 2) throw new Error("A valid Krewe employee is required.");
  return name;
}

function note(value: unknown, minimum: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, 1_000);
  if (text.length < minimum) throw new Error(`A confirmation note of at least ${minimum} characters is required.`);
  return text;
}

function expectedObservation(
  input: Record<string, unknown>,
  key: string,
  label: string,
  requireTimestamp = false,
): string {
  if (!Object.prototype.hasOwnProperty.call(input, key)) throw new Error(`The current ${label} state is required.`);
  const value = String(input[key] || "").trim();
  if ((requireTimestamp && !value) || (value && !Number.isFinite(Date.parse(value)))) {
    throw new Error(`The ${label} observation is invalid.`);
  }
  return value;
}

export function validateKreweAvailability(value: unknown): KreweAvailabilityInput {
  const input = record(value);
  const status = String(input.status || "").trim();
  if (status !== "available" && status !== "unavailable") {
    throw new Error("Availability must be available or unavailable.");
  }
  return {
    employeeName: employeeName(input.employeeName),
    targetDate: dateKey(input.targetDate, "Krewe target date"),
    status,
    note: note(input.note, 3),
    expectedStoreUpdatedAt: expectedObservation(input, "expectedStoreUpdatedAt", "Krewe control"),
    expectedRecordUpdatedAt: expectedObservation(input, "expectedRecordUpdatedAt", "employee availability"),
  };
}

export function validateKreweScheduleCallIn(value: unknown): KreweScheduleCallInInput {
  const input = record(value);
  const baseDate = dateKey(input.baseDate, "Krewe planning date");
  const targetDate = dateKey(input.targetDate, "Krewe target date");
  const role = String(input.role || "").trim().toLowerCase();
  if (targetDate !== nextDate(baseDate)) throw new Error("A call-in target must be the next operating day.");
  if (role !== "driver" && role !== "crew") throw new Error("A driver or Krewe role is required.");
  if (input.availabilityConfirmed !== true) throw new Error("Human-confirmed employee availability is required.");
  return {
    employeeName: employeeName(input.employeeName),
    baseDate,
    targetDate,
    role,
    note: note(input.note, 5),
    availabilityConfirmed: true,
    expectedScheduleUpdatedAt: expectedObservation(input, "expectedScheduleUpdatedAt", "JunkWare schedule", true),
    expectedStoreUpdatedAt: expectedObservation(input, "expectedStoreUpdatedAt", "Krewe control"),
    expectedRecordUpdatedAt: expectedObservation(input, "expectedRecordUpdatedAt", "employee availability"),
  };
}

function entityMatchesEmployee(entityId: string, employee: string): void {
  if (normalizeEmployeeKey(entityId) !== normalizeEmployeeKey(employee)) {
    throw new Error("Krewe employee identity mismatch.");
  }
}

export const kreweActionDefinitions: ActionDefinition<any>[] = [
  {
    key: "krewe.record_availability.v1",
    version: 1,
    title: "Record Krewe availability",
    riskClass: 1,
    supportedEntityTypes: ["employee"],
    requiredPermission: "operations.write",
    validateInput: validateKreweAvailability,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [
      normalizeEmployeeKey(entity.id), input.targetDate, input.status, input.note,
      input.expectedRecordUpdatedAt || "new", input.expectedStoreUpdatedAt || "initial",
    ].join("|"),
    execute: async (context) => {
      entityMatchesEmployee(context.entity.id, context.input.employeeName);
      const receipt = await executeKreweAvailability(context.input, context.actor.displayName);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifyKreweAvailability(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeKreweAvailability>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|invalid|committed call-in|identity mismatch/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh the Krewe plan, reconfirm the employee’s response, then record availability against the current employee record.",
    emittedEventTypes: ["krewe.availability_recorded.v1", "krewe.availability_verified.v1"],
  },
  {
    key: "krewe.schedule_call_in.v1",
    version: 1,
    title: "Commit Krewe call-in",
    riskClass: 2,
    supportedEntityTypes: ["employee"],
    requiredPermission: "operations.write",
    validateInput: validateKreweScheduleCallIn,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [
      normalizeEmployeeKey(entity.id), input.targetDate, input.role, input.note,
      input.expectedScheduleUpdatedAt, input.expectedRecordUpdatedAt || "new", input.expectedStoreUpdatedAt || "initial",
    ].join("|"),
    execute: async (context) => {
      entityMatchesEmployee(context.entity.id, context.input.employeeName);
      const receipt = await executeKreweScheduleCallIn(context.input, context.actor.displayName);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifyKreweScheduleCallIn(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeKreweScheduleCallIn>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|invalid|unavailable|already has|not available|identity mismatch/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh tomorrow’s schedule and Krewe response state. Reconfirm availability, role, and staffing need before submitting a new call-in request.",
    emittedEventTypes: ["krewe.call_in_requested.v1", "krewe.call_in_verified.v1"],
  },
];
