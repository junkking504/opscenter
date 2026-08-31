import type { ActionVerification } from "@/lib/platform/contracts";
import {
  normalizeEmployeeKey,
  readManualBonusStore,
  summarizeManualBonusesForDate,
  upsertManualBonusEntryIfCurrent,
} from "@/lib/manual-bonuses";
import {
  normalizePayrollEmployeeKey,
  payrollCorrectionForEmployee,
  readPayrollCorrectionStore,
  upsertPayrollCorrection,
} from "@/lib/payroll-corrections";
import { buildDailyPaymentReconciliation, type PaymentReconciliationView } from "@/lib/payment-reconciliation";
import { crewRows, readMetrics } from "@/lib/opsData";
import { getOpsRuntime } from "@/lib/runtime";

export type FinanceControlMode = "live_control" | "preview_simulation";

export type FinanceControlSnapshot = {
  date: string;
  mode: FinanceControlMode;
  source: "Truck Records + JunkWare payments + QuickBooks Online";
  sourceObservedAt: string;
  employees: Array<{ name: string; normalizedName: string; correctionUpdatedAt: string }>;
  paymentReconciliation: Pick<
    PaymentReconciliationView,
    | "status"
    | "generatedAt"
    | "merchantCenterAvailable"
    | "merchantCenterFresh"
    | "merchantCenterCollectedAt"
    | "merchantSourceName"
    | "merchantCollector"
  > & {
    summary: PaymentReconciliationView["summary"];
    exceptionCount: number;
  };
  manualBonuses: {
    count: number;
    totalAmount: number;
    storeUpdatedAt: string;
  };
  payrollCorrections: {
    count: number;
    storeUpdatedAt: string;
  };
  authorityNotice: string;
};

export type FinanceManualBonusInput = {
  employeeName: string;
  workDate: string;
  amount: number;
  note: string;
  expectedBonusStoreUpdatedAt: string;
};

export type FinancePayrollCorrectionInput = {
  employeeName: string;
  workDate: string;
  clockIn: string;
  clockOut: string;
  hourlyRate: number;
  note: string;
  expectedPayrollStoreUpdatedAt: string;
  expectedCorrectionUpdatedAt: string;
};

export type FinanceExecutionReceipt = {
  mode: FinanceControlMode;
  recordId: string;
  employeeName: string;
  workDate: string;
  changed: boolean;
  verified: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

export function financeControlMode(): FinanceControlMode {
  return getOpsRuntime() === "MISSION_CONTROL" ? "live_control" : "preview_simulation";
}

function employeeNameFromRow(row: Record<string, unknown>): string {
  const raw = String(row.name || row.employee_name || row.employee || row.crew_member || "").trim();
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  return (parts.length === 2 ? `${parts[1]} ${parts[0]}` : raw).replace(/\s+/g, " ").trim();
}

function financeEmployees(date: string): Array<{ name: string; normalizedName: string; correctionUpdatedAt: string }> {
  const bonusStore = readManualBonusStore();
  const payrollStore = readPayrollCorrectionStore();
  const names = [
    ...crewRows(readMetrics(date)).map(employeeNameFromRow),
    ...bonusStore.entries.map((entry) => entry.employeeName),
    ...payrollStore.corrections.map((correction) => correction.employeeName),
  ].filter(Boolean);
  const byNormalizedName = new Map<string, string>();
  for (const name of names) {
    const normalizedName = normalizeEmployeeKey(name);
    if (normalizedName && !byNormalizedName.has(normalizedName)) byNormalizedName.set(normalizedName, name);
  }
  const corrections = payrollStore.corrections.filter((correction) => correction.workDate === date);
  return Array.from(byNormalizedName, ([normalizedName, name]) => ({
    name,
    normalizedName,
    correctionUpdatedAt: corrections.find((correction) => correction.normalizedEmployeeName === normalizedName)?.updatedAt || "",
  }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function readFinanceControlSnapshot(date: string): FinanceControlSnapshot {
  const reconciliation = buildDailyPaymentReconciliation(date);
  const bonusStore = readManualBonusStore();
  const bonusSummary = summarizeManualBonusesForDate(date);
  const payrollStore = readPayrollCorrectionStore();
  const corrections = payrollStore.corrections.filter((correction) => correction.workDate === date);
  const sourceObservedAt = [
    reconciliation.generatedAt || "",
    reconciliation.merchantCenterCollectedAt || "",
    bonusStore.updatedAt,
    payrollStore.updatedAt,
  ].filter(Boolean).sort().at(-1) || "";
  return {
    date,
    mode: financeControlMode(),
    source: "Truck Records + JunkWare payments + QuickBooks Online",
    sourceObservedAt,
    employees: financeEmployees(date),
    paymentReconciliation: {
      status: reconciliation.status,
      summary: reconciliation.summary,
      exceptionCount: reconciliation.exceptions.length,
      generatedAt: reconciliation.generatedAt,
      merchantCenterAvailable: reconciliation.merchantCenterAvailable,
      merchantCenterFresh: reconciliation.merchantCenterFresh,
      merchantCenterCollectedAt: reconciliation.merchantCenterCollectedAt,
      merchantSourceName: reconciliation.merchantSourceName,
      merchantCollector: reconciliation.merchantCollector,
    },
    manualBonuses: {
      count: bonusSummary.entries.length,
      totalAmount: bonusSummary.totalAmount,
      storeUpdatedAt: bonusStore.updatedAt,
    },
    payrollCorrections: {
      count: corrections.length,
      storeUpdatedAt: payrollStore.updatedAt,
    },
    authorityNotice: "Payment exceptions and QBO evidence are read-only and never auto-cleared. Bonus and payroll changes require a separate manager or administrator approval.",
  };
}

function assertBonusState(input: FinanceManualBonusInput): void {
  if (readManualBonusStore().updatedAt !== input.expectedBonusStoreUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Manual bonus state changed after this request was prepared.");
  }
}

function assertPayrollState(input: FinancePayrollCorrectionInput): void {
  const store = readPayrollCorrectionStore();
  if (store.updatedAt !== input.expectedPayrollStoreUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Payroll correction state changed after this request was prepared.");
  }
  const current = payrollCorrectionForEmployee(input.workDate, input.employeeName);
  if (String(current?.updatedAt || "") !== input.expectedCorrectionUpdatedAt) {
    throw new Error("VERSION_CONFLICT: The payroll correction changed after this request was prepared.");
  }
}

export async function executeFinanceManualBonus(
  input: FinanceManualBonusInput,
): Promise<FinanceExecutionReceipt> {
  assertBonusState(input);
  const mode = financeControlMode();
  if (mode === "preview_simulation") {
    return {
      mode,
      recordId: "preview-simulation",
      employeeName: input.employeeName,
      workDate: input.workDate,
      changed: true,
      verified: true,
      summary: "Preview simulation verified; no manual bonus or payroll total was changed.",
      evidence: { employeeName: input.employeeName, workDate: input.workDate, requestedRecord: "manual_bonus" },
    };
  }
  const entry = upsertManualBonusEntryIfCurrent(input, {
    storeUpdatedAt: input.expectedBonusStoreUpdatedAt,
  });
  if (!entry) throw new Error("The manual bonus could not be recorded.");
  return {
    mode,
    recordId: entry.entryId,
    employeeName: entry.employeeName,
    workDate: entry.workDate,
    changed: true,
    verified: true,
    summary: `Manual bonus for ${entry.employeeName} verified in Finance payroll inputs.`,
    evidence: { entryId: entry.entryId, workDate: entry.workDate, updatedAt: entry.updatedAt },
  };
}

export async function executeFinancePayrollCorrection(
  input: FinancePayrollCorrectionInput,
  actorLabel = "Approved OpsCenter finance actor",
): Promise<FinanceExecutionReceipt> {
  assertPayrollState(input);
  const mode = financeControlMode();
  if (mode === "preview_simulation") {
    return {
      mode,
      recordId: "preview-simulation",
      employeeName: input.employeeName,
      workDate: input.workDate,
      changed: true,
      verified: true,
      summary: "Preview simulation verified; no payroll correction or pay-period result was changed.",
      evidence: { employeeName: input.employeeName, workDate: input.workDate, requestedRecord: "payroll_correction" },
    };
  }
  const correction = upsertPayrollCorrection({ ...input, updatedBy: actorLabel }, {
    storeUpdatedAt: input.expectedPayrollStoreUpdatedAt,
    correctionUpdatedAt: input.expectedCorrectionUpdatedAt,
  });
  if (!correction) throw new Error("The payroll correction could not be recorded.");
  return {
    mode,
    recordId: correction.correctionId,
    employeeName: correction.employeeName,
    workDate: correction.workDate,
    changed: true,
    verified: true,
    summary: `Payroll correction for ${correction.employeeName} verified in Finance payroll inputs.`,
    evidence: { correctionId: correction.correctionId, workDate: correction.workDate, updatedAt: correction.updatedAt },
  };
}

export async function verifyFinanceManualBonus(
  receipt: FinanceExecutionReceipt,
  input: FinanceManualBonusInput,
): Promise<ActionVerification> {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const entry = readManualBonusStore().entries.find((candidate) => candidate.entryId === receipt.recordId);
  if (
    !entry
    || entry.normalizedEmployeeName !== normalizeEmployeeKey(input.employeeName)
    || entry.workDate !== input.workDate
    || entry.amount !== input.amount
    || entry.note !== input.note
  ) {
    return { outcome: "mismatch", summary: "The Finance manual bonus record does not match the approved request." };
  }
  return {
    outcome: "verified",
    verifiedAt: entry.updatedAt,
    summary: receipt.summary,
    evidence: { entryId: entry.entryId, workDate: entry.workDate, updatedAt: entry.updatedAt },
  };
}

export async function verifyFinancePayrollCorrection(
  receipt: FinanceExecutionReceipt,
  input: FinancePayrollCorrectionInput,
): Promise<ActionVerification> {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const correction = payrollCorrectionForEmployee(input.workDate, input.employeeName);
  if (
    !correction
    || correction.correctionId !== receipt.recordId
    || correction.normalizedEmployeeName !== normalizePayrollEmployeeKey(input.employeeName)
    || correction.clockIn !== input.clockIn
    || correction.clockOut !== input.clockOut
    || correction.hourlyRate !== input.hourlyRate
    || correction.note !== input.note
  ) {
    return { outcome: "mismatch", summary: "The Finance payroll correction does not match the approved request." };
  }
  return {
    outcome: "verified",
    verifiedAt: correction.updatedAt,
    summary: receipt.summary,
    evidence: { correctionId: correction.correctionId, workDate: correction.workDate, updatedAt: correction.updatedAt },
  };
}
