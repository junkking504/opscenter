import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { ActionVerification, WorkItem } from "@/lib/platform/contracts";
import { withJunkwareAppointmentSyncLock } from "@/lib/job-route-assignments";
import { junkwareJobCloseout } from "@/lib/junkware-job-closeout";
import { getWorkItem } from "@/lib/platform/persistence/work-items";
import { getOpsRuntime } from "@/lib/runtime";
import { publishVerifiedTruckCloseout } from "@/lib/slack-alerts";
import { recordTruckLoadFromCloseout } from "@/lib/truck-load-status";

export type JobCloseoutMode = "live_control" | "preview_simulation";

export type JobCloseoutPayload = {
  driverId: string;
  navigatorIds: string[];
  loadQuantity: string;
  loadSize: string;
  loadPrice: string;
  bedloadQuantity: string;
  bedloadSize: string;
  bedloadPrice: string;
  otherChargesToAdd: Array<{ typeValue: string; quantity: string; price: string }>;
  discount: string;
  tip: string;
  jobCategoryId: string;
  actualStartHour: string;
  actualStartMinute: string;
  actualEndHour: string;
  actualEndMinute: string;
  addPayment: { methodId: string; amount: string } | null;
};

export type JobCloseoutInput = {
  appointmentId: string;
  serviceDate: string;
  sourceObservedAt: string;
  expectedObservationKey: string;
  workItemId: string;
  expectedWorkItemVersion: number;
  closeout: JobCloseoutPayload;
};

export type JobCloseoutReceipt = {
  mode: JobCloseoutMode;
  appointmentId: string;
  workItemId: string;
  changed: boolean;
  verified: boolean;
  verifiedAt: string;
  summary: string;
  evidence: Record<string, unknown>;
};

export type JobCloseoutAdapter = (
  appointmentId: string,
  payload?: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

const CLOSEOUT_WORK_RULES = new Set([
  "completed_job_with_no_driver",
  "completed_job_with_no_navigator",
  "job_with_revenue_but_no_credited_crew",
  "payment_amount_present_but_payment_type_missing",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function selected(value: unknown): unknown {
  const row = record(value);
  return { value: String(row.value || ""), label: String(row.label || "") };
}

function options(value: unknown): Array<{ value: string; label: string }> {
  return Array.isArray(value)
    ? value.map((item) => ({ value: String(record(item).value || ""), label: String(record(item).label || "") }))
    : [];
}

function closeoutObservation(closeoutValue: unknown): Record<string, unknown> {
  const closeout = record(closeoutValue);
  return {
    status: selected(closeout.status),
    driver: selected(closeout.driver),
    drivers: options(closeout.drivers),
    navigators: options(closeout.navigators),
    navigatorOptions: options(closeout.navigatorOptions),
    loadQuantity: String(closeout.loadQuantity || ""),
    loadSize: selected(closeout.loadSize),
    loadSizeOptions: options(record(closeout.loadSize).options),
    loadPrice: String(closeout.loadPrice || ""),
    bedloadQuantity: String(closeout.bedloadQuantity || ""),
    bedloadSize: selected(closeout.bedloadSize),
    bedloadSizeOptions: options(record(closeout.bedloadSize).options),
    bedloadPrice: String(closeout.bedloadPrice || ""),
    otherChargeOptions: options(closeout.otherChargeOptions),
    otherCharges: Array.isArray(closeout.otherCharges) ? closeout.otherCharges.map((item) => {
      const row = record(item);
      return {
        label: String(row.label || ""),
        quantity: String(row.quantity || ""),
        price: String(row.price || ""),
        total: String(row.total || ""),
      };
    }) : [],
    discount: String(closeout.discount || ""),
    tip: String(closeout.tip || ""),
    jobCategory: selected(closeout.jobCategory),
    actualStartHour: selected(closeout.actualStartHour),
    actualStartMinute: selected(closeout.actualStartMinute),
    actualEndHour: selected(closeout.actualEndHour),
    actualEndMinute: selected(closeout.actualEndMinute),
    paymentMethods: options(closeout.paymentMethods),
    payments: Array.isArray(closeout.payments) ? closeout.payments.map((item) => ({
      description: String(record(item).description || ""),
      amount: String(record(item).amount || ""),
    })) : [],
    balance: String(closeout.balance || ""),
    total: String(closeout.total || ""),
  };
}

export function jobCloseoutObservationKey(closeout: unknown): string {
  return createHash("sha256").update(JSON.stringify(closeoutObservation(closeout))).digest("hex");
}

export function jobCloseoutMode(): JobCloseoutMode {
  return getOpsRuntime() === "MISSION_CONTROL" ? "live_control" : "preview_simulation";
}

export function decorateJobCloseoutResult(resultValue: unknown): Record<string, unknown> {
  const result = record(resultValue);
  const closeout = record(result.closeout);
  return {
    ...result,
    observationKey: jobCloseoutObservationKey(closeout),
    sourceObservedAt: String(result.verifiedAt || new Date().toISOString()),
    controlMode: jobCloseoutMode(),
  };
}

export async function readJobCloseoutControlSnapshot(
  appointmentId: string,
  adapter: JobCloseoutAdapter = junkwareJobCloseout,
): Promise<Record<string, unknown>> {
  const result = await withJunkwareAppointmentSyncLock(appointmentId, () => adapter(appointmentId));
  return decorateJobCloseoutResult(result);
}

async function assertCurrentWork(
  input: JobCloseoutInput,
  workItemReader: (id: string) => Promise<WorkItem | null> = getWorkItem,
): Promise<void> {
  const item = await workItemReader(input.workItemId);
  if (!item) throw new Error("The linked closeout work item is unavailable.");
  if (item.entity.type !== "job" || item.entity.id !== input.appointmentId) {
    throw new Error("The linked closeout work item does not match this JunkWare appointment.");
  }
  if (item.version !== input.expectedWorkItemVersion) {
    throw new Error("VERSION_CONFLICT: The closeout work item changed after this request was prepared.");
  }
  if (["resolved", "dismissed"].includes(item.status)) {
    throw new Error("VERSION_CONFLICT: The closeout work item is no longer active.");
  }
  if (!CLOSEOUT_WORK_RULES.has(item.rule)) {
    throw new Error("The selected work item is not a supported JunkWare closeout correction.");
  }
}

function loadSlackBotTokenFromKeychain(): void {
  if (String(process.env.SLACK_BOT_TOKEN || "").trim() || process.platform !== "darwin") return;
  try {
    const token = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-a", "opscenter", "-s", "com.opscenter.slack-bot-token", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (token.startsWith("xoxb-")) process.env.SLACK_BOT_TOKEN = token;
  } catch {
    // The regular collector will retry the closeout alert when credentials are unavailable.
  }
}

async function recordVerifiedSideEffects(
  input: JobCloseoutInput,
  resultValue: Record<string, unknown>,
  actorLabel: string,
): Promise<Record<string, unknown>> {
  const closeout = record(resultValue.closeout);
  const loadSize = typeof closeout.loadSize === "object"
    ? String(record(closeout.loadSize).label || "")
    : String(closeout.loadSize || "");
  let truckLoadUpdated = false;
  let slackDelivered = false;
  try {
    truckLoadUpdated = recordTruckLoadFromCloseout({
      date: input.serviceDate,
      truck: String(closeout.truck || ""),
      appointmentId: input.appointmentId,
      jobNumber: String(closeout.jobNumber || ""),
      loadSize,
      loadQuantity: closeout.loadQuantity,
      verifiedAt: String(resultValue.verifiedAt || ""),
      recordedBy: actorLabel,
    }).updated;
  } catch {
    truckLoadUpdated = false;
  }
  loadSlackBotTokenFromKeychain();
  try {
    const delivery = await publishVerifiedTruckCloseout({
      appointmentId: input.appointmentId,
      jobNumber: String(closeout.jobNumber || ""),
      truck: String(closeout.truck || ""),
      closeout,
    });
    slackDelivered = Boolean(delivery);
  } catch {
    slackDelivered = false;
  }
  return { truckLoadUpdated, slackDelivered };
}

export async function executeJobCloseout(
  input: JobCloseoutInput,
  actorLabel: string,
  dependencies: {
    adapter?: JobCloseoutAdapter;
    workItemReader?: (id: string) => Promise<WorkItem | null>;
  } = {},
): Promise<JobCloseoutReceipt> {
  const adapter = dependencies.adapter || junkwareJobCloseout;
  await assertCurrentWork(input, dependencies.workItemReader);
  const mode = jobCloseoutMode();
  const execution = await withJunkwareAppointmentSyncLock(input.appointmentId, async () => {
    const current = await adapter(input.appointmentId);
    const currentCloseout = record(current.closeout);
    const currentObservationKey = jobCloseoutObservationKey(currentCloseout);
    if (currentObservationKey !== input.expectedObservationKey) {
      throw new Error("VERSION_CONFLICT: The JunkWare closeout changed after this request was prepared.");
    }
    if (mode === "preview_simulation") return { current, result: null };
    return { current, result: await adapter(input.appointmentId, input.closeout) };
  });

  const baseEvidence = {
    appointmentId: input.appointmentId,
    workItemId: input.workItemId,
    sourceObservedAt: input.sourceObservedAt,
    sourceObservationKey: input.expectedObservationKey,
    paymentRequested: Boolean(input.closeout.addPayment),
  };
  if (mode === "preview_simulation") {
    return {
      mode,
      appointmentId: input.appointmentId,
      workItemId: input.workItemId,
      changed: false,
      verified: true,
      verifiedAt: new Date().toISOString(),
      summary: "Preview simulation verified against the current JunkWare closeout; no closeout, payment, truck-load, or Slack state changed.",
      evidence: { ...baseEvidence, externalWrite: false },
    };
  }

  const result = record(execution.result);
  if (!result.ok || !result.closeout) throw new Error("JunkWare did not return a verified closeout read-back.");
  const verifiedAt = String(result.verifiedAt || new Date().toISOString());
  const sideEffects = await recordVerifiedSideEffects(input, result, actorLabel);
  return {
    mode,
    appointmentId: input.appointmentId,
    workItemId: input.workItemId,
    changed: true,
    verified: true,
    verifiedAt,
    summary: "Closeout fields were written and read back from JunkWare. The originating work remains open until fresh exception detection clears it.",
    evidence: { ...baseEvidence, externalWrite: true, ...sideEffects },
  };
}

export function verifyJobCloseout(receipt: JobCloseoutReceipt): ActionVerification {
  if (!receipt.verified) return { outcome: "mismatch", summary: "JunkWare closeout verification was not retained." };
  return {
    outcome: "verified",
    verifiedAt: receipt.verifiedAt,
    summary: receipt.summary,
    evidence: receipt.evidence,
  };
}
