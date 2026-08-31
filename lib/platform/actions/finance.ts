import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executeFinanceManualBonus,
  executeFinancePayrollCorrection,
  verifyFinanceManualBonus,
  verifyFinancePayrollCorrection,
  type FinanceManualBonusInput,
  type FinancePayrollCorrectionInput,
} from "@/lib/finance-control";
import { normalizeEmployeeKey } from "@/lib/manual-bonuses";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function dateKey(value: unknown): string {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid Finance work date is required.");
  return date;
}

function employeeName(value: unknown): string {
  const name = String(value || "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (name.length < 2) throw new Error("A valid employee is required.");
  return name;
}

function note(value: unknown, label: string): string {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, 1_000);
  if (text.length < 5) throw new Error(`${label} of at least 5 characters is required.`);
  return text;
}

function expectedObservation(input: Record<string, unknown>, key: string, label: string): string {
  if (!Object.prototype.hasOwnProperty.call(input, key)) throw new Error(`The current ${label} state is required.`);
  const value = String(input[key] || "").trim();
  if (value && !Number.isFinite(Date.parse(value))) throw new Error(`The ${label} observation is invalid.`);
  return value;
}

function money(value: unknown, label: string, maximum: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > maximum) {
    throw new Error(`${label} must be greater than $0 and no more than $${maximum.toLocaleString("en-US")}.`);
  }
  return Number(amount.toFixed(2));
}

function clock(value: unknown, required: boolean): string {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!raw && !required) return "";
  const match = raw.match(/^(\d{1,2}):(\d{2}) (AM|PM)$/);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    throw new Error("Payroll correction times must use HH:MM AM/PM.");
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${match[3]}`;
}

export function validateFinanceManualBonus(value: unknown): FinanceManualBonusInput {
  const input = record(value);
  return {
    employeeName: employeeName(input.employeeName),
    workDate: dateKey(input.workDate),
    amount: money(input.amount, "Manual bonus", 10_000),
    note: note(input.note, "A bonus reason"),
    expectedBonusStoreUpdatedAt: expectedObservation(input, "expectedBonusStoreUpdatedAt", "manual bonus"),
  };
}

export function validateFinancePayrollCorrection(value: unknown): FinancePayrollCorrectionInput {
  const input = record(value);
  return {
    employeeName: employeeName(input.employeeName),
    workDate: dateKey(input.workDate),
    clockIn: clock(input.clockIn, true),
    clockOut: clock(input.clockOut, false),
    hourlyRate: money(input.hourlyRate, "Hourly rate", 500),
    note: note(input.note, "A correction reason"),
    expectedPayrollStoreUpdatedAt: expectedObservation(input, "expectedPayrollStoreUpdatedAt", "payroll correction"),
    expectedCorrectionUpdatedAt: expectedObservation(input, "expectedCorrectionUpdatedAt", "employee correction"),
  };
}

function entityMatchesEmployee(entityId: string, employee: string): void {
  if (normalizeEmployeeKey(entityId) !== normalizeEmployeeKey(employee)) {
    throw new Error("Finance employee identity mismatch.");
  }
}

export const financeActionDefinitions: ActionDefinition<any>[] = [
  {
    key: "finance.record_manual_bonus.v1",
    version: 1,
    title: "Record manual bonus",
    riskClass: 3,
    supportedEntityTypes: ["employee"],
    requiredPermission: "sensitive.write",
    validateInput: validateFinanceManualBonus,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [
      normalizeEmployeeKey(entity.id), input.workDate, input.amount, input.note, input.expectedBonusStoreUpdatedAt || "initial",
    ].join("|"),
    execute: async (context) => {
      entityMatchesEmployee(context.entity.id, context.input.employeeName);
      const receipt = await executeFinanceManualBonus(context.input);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifyFinanceManualBonus(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeFinanceManualBonus>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|valid|identity mismatch|no more than/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh Finance payroll inputs, confirm the employee and amount, then submit a new manual-bonus request against the current store version.",
    emittedEventTypes: ["finance.manual_bonus_requested.v1", "finance.manual_bonus_verified.v1"],
  },
  {
    key: "finance.record_payroll_correction.v1",
    version: 1,
    title: "Record payroll correction",
    riskClass: 3,
    supportedEntityTypes: ["employee"],
    requiredPermission: "sensitive.write",
    validateInput: validateFinancePayrollCorrection,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [
      normalizeEmployeeKey(entity.id), input.workDate, input.expectedCorrectionUpdatedAt || "new",
      input.clockIn, input.clockOut || "open", input.hourlyRate, input.note, input.expectedPayrollStoreUpdatedAt || "initial",
    ].join("|"),
    execute: async (context) => {
      entityMatchesEmployee(context.entity.id, context.input.employeeName);
      const receipt = await executeFinancePayrollCorrection(context.input, context.actor.displayName);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifyFinancePayrollCorrection(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeFinancePayrollCorrection>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|valid|identity mismatch|no more than/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh the employee payroll correction, confirm the time and rate evidence, then submit a new request against the current correction version.",
    emittedEventTypes: ["finance.payroll_correction_requested.v1", "finance.payroll_correction_verified.v1"],
  },
];
