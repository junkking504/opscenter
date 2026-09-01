import type { ActionVerification } from "@/lib/platform/contracts";
import { getOpsRuntime } from "@/lib/runtime";
import {
  deriveTruckLoadStatus,
  readTruckLoadStore,
  resetTruckLoad,
  setTruckStartingLoad,
  type TruckLoadResetLocation,
} from "@/lib/truck-load-status";

export type TruckLoadControlMode = "live_control" | "preview_simulation";

export type TruckLoadStartingInput = {
  date: string;
  truck: string;
  loadFraction: number;
  expectedStoreUpdatedAt: string;
};

export type TruckLoadResetInput = {
  date: string;
  truck: string;
  location: TruckLoadResetLocation;
  expectedStoreUpdatedAt: string;
};

export type TruckLoadExecutionReceipt = {
  mode: TruckLoadControlMode;
  truck: string;
  eventId: string;
  changed: boolean;
  verified: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

export function truckLoadControlMode(): TruckLoadControlMode {
  return getOpsRuntime() === "MISSION_CONTROL" ? "live_control" : "preview_simulation";
}

function currentStore(expectedStoreUpdatedAt: string) {
  const store = readTruckLoadStore();
  if (store.updatedAt !== expectedStoreUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Truck load state changed after this request was prepared.");
  }
  return store;
}

function startingEventId(input: TruckLoadStartingInput): string {
  return `day-start:${input.date}:${input.truck.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function previewReceipt(input: TruckLoadStartingInput | TruckLoadResetInput, requestedState: Record<string, unknown>): TruckLoadExecutionReceipt {
  return {
    mode: "preview_simulation",
    truck: input.truck,
    eventId: "preview-simulation",
    changed: false,
    verified: true,
    summary: "Preview simulation verified; this action made no change to shared truck-load state.",
    evidence: {
      truck: input.truck,
      date: input.date,
      sourceStoreUpdatedAt: input.expectedStoreUpdatedAt,
      requestedState,
      externalWrite: false,
    },
  };
}

export async function executeTruckStartingLoad(
  input: TruckLoadStartingInput,
  recordedBy: string,
): Promise<TruckLoadExecutionReceipt> {
  const store = readTruckLoadStore();
  const eventId = startingEventId(input);
  const existing = store.events.find((event) => event.eventId === eventId);
  const mode = truckLoadControlMode();
  currentStore(input.expectedStoreUpdatedAt);
  if (mode === "live_control" && existing?.loadFraction === input.loadFraction) {
    return {
      mode,
      truck: input.truck,
      eventId,
      changed: false,
      verified: true,
      summary: `${input.truck} already has the approved starting load in OpsCenter.`,
      evidence: { eventId, loadFraction: input.loadFraction, storeUpdatedAt: store.updatedAt, externalWrite: false },
    };
  }
  if (mode === "preview_simulation") {
    return previewReceipt(input, { startingLoadFraction: input.loadFraction });
  }
  const status = setTruckStartingLoad({
    ...input,
    recordedBy,
    expectedStoreUpdatedAt: input.expectedStoreUpdatedAt,
  });
  const writtenStore = readTruckLoadStore();
  const event = writtenStore.events.find((candidate) => candidate.eventId === eventId);
  if (!event || event.loadFraction !== input.loadFraction) throw new Error("The approved starting load could not be read back from OpsCenter.");
  return {
    mode: "live_control",
    truck: input.truck,
    eventId,
    changed: true,
    verified: true,
    summary: `${input.truck} starting load verified in OpsCenter truck-load state.`,
    evidence: {
      eventId,
      loadFraction: status.startingLoadFraction,
      currentLoadFraction: status.currentLoadFraction,
      storeUpdatedAt: writtenStore.updatedAt,
      externalWrite: false,
    },
  };
}

export async function executeTruckLoadReset(
  input: TruckLoadResetInput,
  context: { actionRunId: string; recordedBy: string },
): Promise<TruckLoadExecutionReceipt> {
  const eventId = `yard-reset:${context.actionRunId}`;
  const store = readTruckLoadStore();
  const existing = store.events.find((event) => event.eventId === eventId);
  const mode = truckLoadControlMode();
  if (mode === "live_control" && existing && existing.date === input.date && existing.truck === input.truck && existing.resetLocation === input.location) {
    return {
      mode,
      truck: input.truck,
      eventId,
      changed: false,
      verified: true,
      summary: `${input.truck} ${input.location === "metal_yard" ? "metal-yard" : "dump"} reset is already recorded in OpsCenter.`,
      evidence: { eventId, resetLocation: input.location, storeUpdatedAt: store.updatedAt, externalWrite: false },
    };
  }
  currentStore(input.expectedStoreUpdatedAt);
  if (mode === "preview_simulation") {
    return previewReceipt(input, { currentLoadFraction: 0, resetLocation: input.location });
  }
  const status = resetTruckLoad({
    ...input,
    recordedBy: context.recordedBy,
    eventId: context.actionRunId,
    expectedStoreUpdatedAt: input.expectedStoreUpdatedAt,
  });
  const writtenStore = readTruckLoadStore();
  const event = writtenStore.events.find((candidate) => candidate.eventId === eventId);
  if (!event || event.resetLocation !== input.location) throw new Error("The approved yard reset could not be read back from OpsCenter.");
  return {
    mode: "live_control",
    truck: input.truck,
    eventId,
    changed: true,
    verified: true,
    summary: `${input.truck} ${input.location === "metal_yard" ? "metal-yard" : "dump"} reset verified in OpsCenter truck-load state.`,
    evidence: {
      eventId,
      resetLocation: input.location,
      currentLoadFraction: status.currentLoadFraction,
      storeUpdatedAt: writtenStore.updatedAt,
      externalWrite: false,
    },
  };
}

export async function verifyTruckStartingLoad(
  receipt: TruckLoadExecutionReceipt,
  input: TruckLoadStartingInput,
): Promise<ActionVerification> {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const event = readTruckLoadStore().events.find((candidate) => candidate.eventId === receipt.eventId);
  if (!event || event.date !== input.date || event.truck !== input.truck || event.kind !== "day_start" || event.loadFraction !== input.loadFraction) {
    return { outcome: "mismatch", summary: "The truck-load ledger does not contain the approved starting load." };
  }
  return {
    outcome: "verified",
    verifiedAt: event.recordedAt,
    summary: receipt.summary,
    evidence: { ...receipt.evidence, recordedAt: event.recordedAt, recordedBy: event.recordedBy },
  };
}

export async function verifyTruckLoadReset(
  receipt: TruckLoadExecutionReceipt,
  input: TruckLoadResetInput,
): Promise<ActionVerification> {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const store = readTruckLoadStore();
  const event = store.events.find((candidate) => candidate.eventId === receipt.eventId);
  if (!event || event.date !== input.date || event.truck !== input.truck || event.kind !== "yard_reset" || event.resetLocation !== input.location) {
    return { outcome: "mismatch", summary: "The truck-load ledger does not contain the approved yard reset." };
  }
  const status = deriveTruckLoadStatus(input.date, input.truck, store.events);
  return {
    outcome: "verified",
    verifiedAt: event.recordedAt,
    summary: receipt.summary,
    evidence: { ...receipt.evidence, currentLoadFraction: status.currentLoadFraction, recordedAt: event.recordedAt, recordedBy: event.recordedBy },
  };
}
