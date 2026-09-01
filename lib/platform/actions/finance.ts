import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executeFinanceManualBonus,
  executeFinancePaymentExceptionReview,
  executeFinancePayrollCorrection,
  verifyFinanceManualBonus,
  verifyFinancePaymentExceptionReview,
  verifyFinancePayrollCorrection,
  type FinanceManualBonusInput,
  type FinancePaymentExceptionReviewInput,
  type FinancePayrollCorrectionInput,
} from "@/lib/finance-control";
import { normalizeEmployeeKey } from "@/lib/manual-bonuses";
import {
  PAYMENT_EXCEPTION_REVIEW_DISPOSITIONS,
  type PaymentExceptionReviewDisposition,
} from "@/lib/payment-exception-reviews";

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

function boundedText(value: unknown, label: string, minimum: number, maximum: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
  if (text.length < minimum) throw new Error(`${label} of at least ${minimum} characters is required.`);
  return text;
}

function rejectSensitiveReviewText(values: string[]): void {
  const text = values.join(" ");
  const prohibited = [
    /xox[baprs]-[a-z0-9-]+/i,
    /\bbearer\s+[a-z0-9._-]+/i,
    /\b(?:password|secret|token)\s*[:=]\s*\S+/i,
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
    throw new Error("Payment review fields cannot contain credentials, contact details, or payment-card data.");
  }
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

export function validateFinancePaymentExceptionReview(value: unknown): FinancePaymentExceptionReviewInput {
  const input = record(value);
  const exceptionId = String(input.exceptionId || "").trim();
  const disposition = String(input.disposition || "").trim() as PaymentExceptionReviewDisposition;
  const owner = boundedText(input.owner, "A payment review owner", 2, 80);
  const nextAction = boundedText(input.nextAction, "A payment review next action", 5, 240);
  const reviewNote = boundedText(input.note, "A payment review evidence note", 5, 1_000);
  const expectedObservationKey = String(input.expectedObservationKey || "").trim();
  if (!/^payment_exception_[0-9a-f]{24}$/.test(exceptionId)) throw new Error("A valid payment exception is required.");
  if (!PAYMENT_EXCEPTION_REVIEW_DISPOSITIONS.includes(disposition)) throw new Error("A valid payment review disposition is required.");
  if (!/^[0-9a-f]{64}$/.test(expectedObservationKey)) throw new Error("The payment reconciliation observation is invalid.");
  rejectSensitiveReviewText([owner, nextAction, reviewNote]);
  return {
    date: dateKey(input.date),
    exceptionId,
    disposition,
    owner,
    nextAction,
    note: reviewNote,
    expectedReviewStoreUpdatedAt: expectedObservation(input, "expectedReviewStoreUpdatedAt", "payment review"),
    expectedReviewUpdatedAt: expectedObservation(input, "expectedReviewUpdatedAt", "payment-exception review"),
    expectedObservationKey,
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
  {
    key: "finance.record_payment_exception_review.v1",
    version: 1,
    title: "Record payment-exception review",
    riskClass: 2,
    supportedEntityTypes: ["finance"],
    requiredPermission: "sensitive.write",
    validateInput: validateFinancePaymentExceptionReview,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [
      entity.id,
      input.expectedObservationKey,
      input.expectedReviewUpdatedAt || "new",
      input.disposition,
      input.owner.toLowerCase(),
      input.nextAction.toLowerCase(),
      input.note,
    ].join("|"),
    execute: async (context) => {
      if (context.entity.id !== context.input.exceptionId) throw new Error("Payment exception identity mismatch.");
      const receipt = await executeFinancePaymentExceptionReview(context.input, context.actor.displayName);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifyFinancePaymentExceptionReview(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeFinancePaymentExceptionReview>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|valid|identity mismatch|no longer present|cannot contain/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh Payments & Recon, confirm the exception still exists, then submit a new owner, disposition, and next action against the current source observation.",
    emittedEventTypes: ["finance.payment_exception_review_requested.v1", "finance.payment_exception_review_verified.v1"],
  },
];
