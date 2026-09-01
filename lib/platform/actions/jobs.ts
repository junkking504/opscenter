import { createHash } from "node:crypto";
import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executeJobCloseout,
  verifyJobCloseout,
  type JobCloseoutInput,
  type JobCloseoutPayload,
} from "@/lib/job-closeout-control";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function boundedId(value: unknown, label: string, required = false): string {
  const text = String(value || "").trim();
  if (required && !text) throw new Error(`${label} is required.`);
  if (text.length > 240 || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

function money(value: unknown, label: string, required = false): string {
  const text = String(value ?? "").replace(/[^0-9.-]/g, "");
  if (!text) {
    if (required) throw new Error(`${label} is required.`);
    return "";
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) throw new Error(`${label} is invalid.`);
  if (required && amount <= 0) throw new Error(`${label} must be greater than zero.`);
  return amount.toFixed(2);
}

function count(value: unknown, label: string, required = false): string {
  const text = String(value ?? "").trim();
  if (!text) {
    if (required) throw new Error(`${label} is required.`);
    return "";
  }
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) throw new Error(`${label} is invalid.`);
  return String(amount);
}

function closeoutPayload(value: unknown): JobCloseoutPayload {
  const input = record(value);
  const navigatorIds = Array.isArray(input.navigatorIds)
    ? input.navigatorIds.map((item) => boundedId(item, "A navigator")).filter(Boolean)
    : [];
  const driverId = boundedId(input.driverId, "A JunkWare driver", true);
  if (navigatorIds.length > 50 || new Set([driverId, ...navigatorIds]).size !== navigatorIds.length + 1) {
    throw new Error("Each closeout Krewe member must be unique and the assignment cannot exceed 50 navigators.");
  }
  const rawCharges = Array.isArray(input.otherChargesToAdd) ? input.otherChargesToAdd : [];
  if (rawCharges.length > 20) throw new Error("No more than 20 Other Charges may be added in one closeout request.");
  const otherChargesToAdd = rawCharges.map((value) => {
    const charge = record(value);
    const typeValue = boundedId(charge.typeValue, "An Other Charge type", true);
    const isPercentage = typeValue.split("|")[2] === "1";
    return {
      typeValue,
      quantity: count(charge.quantity, "An Other Charge quantity", true),
      price: isPercentage ? "" : money(charge.price, "An Other Charge price", true),
    };
  });
  const payment = input.addPayment && typeof input.addPayment === "object" ? record(input.addPayment) : null;
  return {
    driverId,
    navigatorIds,
    loadQuantity: count(input.loadQuantity, "Truck quantity"),
    loadSize: boundedId(input.loadSize, "Load size"),
    loadPrice: money(input.loadPrice, "Load price"),
    bedloadQuantity: count(input.bedloadQuantity, "Bedload quantity"),
    bedloadSize: boundedId(input.bedloadSize, "Bedload size"),
    bedloadPrice: money(input.bedloadPrice, "Bedload price"),
    otherChargesToAdd,
    discount: money(input.discount, "Discount"),
    tip: money(input.tip, "Tip"),
    jobCategoryId: boundedId(input.jobCategoryId, "Job category"),
    actualStartHour: boundedId(input.actualStartHour, "Actual start hour"),
    actualStartMinute: boundedId(input.actualStartMinute, "Actual start minute"),
    actualEndHour: boundedId(input.actualEndHour, "Actual end hour"),
    actualEndMinute: boundedId(input.actualEndMinute, "Actual end minute"),
    addPayment: payment ? {
      methodId: boundedId(payment.methodId, "A payment method", true),
      amount: money(payment.amount, "Payment amount", true),
    } : null,
  };
}

export function validateJobCloseout(value: unknown): JobCloseoutInput {
  const input = record(value);
  const appointmentId = String(input.appointmentId || "").trim();
  const serviceDate = String(input.serviceDate || "").trim();
  const sourceObservedAt = String(input.sourceObservedAt || "").trim();
  const expectedObservationKey = String(input.expectedObservationKey || "").trim();
  const workItemId = boundedId(input.workItemId, "A linked closeout work item", true);
  const expectedWorkItemVersion = Number(input.expectedWorkItemVersion);
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("A valid JunkWare appointment is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) throw new Error("A valid closeout service date is required.");
  if (!Number.isFinite(Date.parse(sourceObservedAt))) throw new Error("A verified JunkWare closeout observation is required.");
  if (!/^[0-9a-f]{64}$/.test(expectedObservationKey)) throw new Error("The JunkWare closeout observation is invalid.");
  if (!Number.isInteger(expectedWorkItemVersion) || expectedWorkItemVersion < 1) throw new Error("A valid closeout work-item version is required.");
  return {
    appointmentId,
    serviceDate,
    sourceObservedAt,
    expectedObservationKey,
    workItemId,
    expectedWorkItemVersion,
    closeout: closeoutPayload(input.closeout),
  };
}

function entityMatches(entityId: string, input: JobCloseoutInput): void {
  if (entityId !== input.appointmentId) throw new Error("JunkWare closeout appointment identity mismatch.");
}

export const jobsActionDefinitions: ActionDefinition<any>[] = [
  {
    key: "jobs.update_closeout.v1",
    version: 1,
    title: "Update and verify JunkWare closeout",
    riskClass: 3,
    supportedEntityTypes: ["job"],
    requiredPermission: "sensitive.write",
    validateInput: validateJobCloseout,
    redactInput: (input) => ({ ...input, closeout: { ...input.closeout } }),
    idempotencyKey: ({ entity, input }) => createHash("sha256")
      .update(JSON.stringify([entity.id, input.workItemId, input.expectedWorkItemVersion, input.expectedObservationKey, input.closeout]))
      .digest("hex"),
    execute: async (context) => {
      entityMatches(context.entity.id, context.input);
      const receipt = await executeJobCloseout(context.input, context.actor.displayName);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (_context, result) => verifyJobCloseout(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeJobCloseout>>,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|invalid|identity mismatch|not supported|no longer active/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh the work item and authoritative JunkWare closeout. Compare crew, charges, time, and payments before submitting a new approval request.",
    emittedEventTypes: ["jobs.closeout_update_requested.v1", "jobs.closeout_update_verified.v1"],
  },
];
