import crypto from "node:crypto";
import type { ActionVerification } from "@/lib/platform/contracts";
import { buildFleetMapPayload, type FleetMapPayload, type FleetTruckMapRecord } from "@/lib/fleet-map";
import {
  linxupDeviceReviewRecord,
  readLinxupDeviceReviewStore,
  saveLinxupDeviceReview,
  type LinxupDeviceReviewRecord,
  type LinxupReviewDisposition,
} from "@/lib/linxup-control-store";
import { getOpsRuntime } from "@/lib/runtime";

export type LinxupControlMode = "live_control" | "preview_simulation";
export type LinxupMapReader = (date: string) => FleetMapPayload | null;

export type LinxupControlDevice = {
  truck: string;
  freshness: string;
  lastGpsUpdate: string;
  deliveryMode: string;
  fallbackActive: boolean;
  latestV3PositionAt: string;
  mappingStatus: string;
  hasVerifiedCoordinate: boolean;
  attentionReason: string;
  observationKey: string;
  reviewCurrent: boolean;
  review: Pick<LinxupDeviceReviewRecord, "recordId" | "disposition" | "note" | "sourceObservationKey" | "updatedAt" | "updatedBy"> | null;
};

export type LinxupControlSnapshot = {
  date: string;
  mode: LinxupControlMode;
  source: "LinxUp telemetry + verified vehicle map + OpsCenter review records";
  sourceObservedAt: string;
  storeUpdatedAt: string;
  gpsDataStatus: string;
  devices: LinxupControlDevice[];
  mappingWarnings: string[];
  summary: {
    devices: number;
    live: number;
    stale: number;
    offline: number;
    missingCoordinate: number;
    fallback: number;
    reviewNeeded: number;
    reviewed: number;
  };
  warning?: string;
  authorityNotice: string;
};

export type LinxupDeviceReviewInput = {
  date: string;
  truck: string;
  disposition: LinxupReviewDisposition;
  note: string;
  expectedStoreUpdatedAt: string;
  expectedRecordUpdatedAt: string;
  expectedObservationKey: string;
};

export type LinxupDeviceReviewReceipt = {
  mode: LinxupControlMode;
  recordId: string;
  truck: string;
  changed: boolean;
  verified: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeLinxupControlTruck(value: unknown): string {
  const match = clean(value).match(/truck\s*#?\s*(\d+)/i);
  return match ? `Truck# ${match[1]}` : "";
}

export function linxupControlMode(): LinxupControlMode {
  return getOpsRuntime() === "MISSION_CONTROL" ? "live_control" : "preview_simulation";
}

export function linxupObservationKey(date: string, device: Pick<
  FleetTruckMapRecord,
  "truck" | "freshnessLabel" | "lastGpsUpdate" | "gpsDeliveryMode" | "gpsFallbackActive" | "latestV3PositionAt" | "mappingStatus" | "hasCoordinates"
>): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    date,
    truck: normalizeLinxupControlTruck(device.truck),
    freshness: clean(device.freshnessLabel),
    lastGpsUpdate: clean(device.lastGpsUpdate),
    deliveryMode: clean(device.gpsDeliveryMode),
    fallbackActive: device.gpsFallbackActive === true,
    latestV3PositionAt: clean(device.latestV3PositionAt),
    mappingStatus: clean(device.mappingStatus),
    hasCoordinates: device.hasCoordinates === true,
  })).digest("hex");
}

function attentionReason(device: FleetTruckMapRecord): string {
  if (device.mappingStatus !== "Mapped") return "Tracker-to-truck mapping needs verification.";
  if (!device.hasCoordinates) return "No verified device coordinate is available.";
  if (device.freshnessLabel === "Offline") return "Tracker has stopped reporting.";
  if (device.freshnessLabel === "GPS Stale") return "The newest device position is stale.";
  if (/unavailable/i.test(device.freshnessLabel)) return "Device location evidence is unavailable.";
  if (device.gpsFallbackActive) return "V3 push is stale; V2 polling is the active fallback.";
  if (device.gpsDeliveryMode === "unavailable") return "No authoritative device delivery lane is available.";
  return "Current device evidence is available.";
}

function needsReview(device: LinxupControlDevice): boolean {
  return device.freshness !== "Live GPS"
    || !device.hasVerifiedCoordinate
    || device.mappingStatus !== "Mapped"
    || device.fallbackActive
    || device.deliveryMode === "unavailable";
}

export function readLinxupControlSnapshot(
  date: string,
  mapReader: LinxupMapReader = buildFleetMapPayload,
): LinxupControlSnapshot {
  const map = mapReader(date);
  const store = readLinxupDeviceReviewStore();
  const devices = (map?.trucks || []).map((device): LinxupControlDevice => {
    const review = store.records.find((record) => record.truck === normalizeLinxupControlTruck(device.truck)) || null;
    const observationKey = linxupObservationKey(date, device);
    return {
      truck: normalizeLinxupControlTruck(device.truck),
      freshness: clean(device.freshnessLabel) || "GPS unavailable",
      lastGpsUpdate: clean(device.lastGpsUpdate),
      deliveryMode: clean(device.gpsDeliveryMode) || "unavailable",
      fallbackActive: device.gpsFallbackActive === true,
      latestV3PositionAt: clean(device.latestV3PositionAt),
      mappingStatus: clean(device.mappingStatus) || "Unmapped",
      hasVerifiedCoordinate: device.hasCoordinates === true,
      attentionReason: attentionReason(device),
      observationKey,
      reviewCurrent: Boolean(review && review.sourceObservationKey === observationKey),
      review: review ? {
        recordId: review.recordId,
        disposition: review.disposition,
        note: review.note,
        sourceObservationKey: review.sourceObservationKey,
        updatedAt: review.updatedAt,
        updatedBy: review.updatedBy,
      } : null,
    };
  }).sort((left, right) => Number(needsReview(right)) - Number(needsReview(left)) || left.truck.localeCompare(right.truck, undefined, { numeric: true }));
  const warningParts = [
    ...(map?.mappingWarnings || []),
    !map ? "The LinxUp device snapshot is unavailable." : "",
  ].filter(Boolean);
  return {
    date,
    mode: linxupControlMode(),
    source: "LinxUp telemetry + verified vehicle map + OpsCenter review records",
    sourceObservedAt: [map?.lastUpdatedAt || "", store.updatedAt].filter(Boolean).sort().at(-1) || "",
    storeUpdatedAt: store.updatedAt,
    gpsDataStatus: map?.gpsDataStatus || "GPS history unavailable",
    devices,
    mappingWarnings: map?.mappingWarnings || [],
    summary: {
      devices: devices.length,
      live: devices.filter((device) => device.freshness === "Live GPS" && device.hasVerifiedCoordinate).length,
      stale: devices.filter((device) => device.freshness === "GPS Stale").length,
      offline: devices.filter((device) => device.freshness === "Offline").length,
      missingCoordinate: devices.filter((device) => !device.hasVerifiedCoordinate).length,
      fallback: devices.filter((device) => device.fallbackActive).length,
      reviewNeeded: devices.filter(needsReview).length,
      reviewed: devices.filter((device) => device.reviewCurrent).length,
    },
    warning: warningParts.length ? warningParts.join(" · ") : undefined,
    authorityNotice: "A device review records a human disposition only. It does not rewrite LinxUp telemetry, change the verified vehicle map, contact the provider, or change truck availability.",
  };
}

function currentDevice(
  input: LinxupDeviceReviewInput,
  mapReader: LinxupMapReader,
): { device: LinxupControlDevice; currentReview: LinxupDeviceReviewRecord | null } {
  const snapshot = readLinxupControlSnapshot(input.date, mapReader);
  if (snapshot.storeUpdatedAt !== input.expectedStoreUpdatedAt) {
    throw new Error("VERSION_CONFLICT: LinxUp review state changed after this request was prepared.");
  }
  const device = snapshot.devices.find((candidate) => candidate.truck === input.truck);
  if (!device) throw new Error("The LinxUp device is no longer available in the current Fleet snapshot.");
  if (device.observationKey !== input.expectedObservationKey) {
    throw new Error("VERSION_CONFLICT: LinxUp device evidence changed after this request was prepared.");
  }
  const currentReview = linxupDeviceReviewRecord(input.truck);
  if (String(currentReview?.updatedAt || "") !== input.expectedRecordUpdatedAt) {
    throw new Error("VERSION_CONFLICT: The truck review changed after this request was prepared.");
  }
  return { device, currentReview };
}

export async function executeLinxupDeviceReview(
  input: LinxupDeviceReviewInput,
  actorLabel = "Approved OpsCenter manager",
  mapReader: LinxupMapReader = buildFleetMapPayload,
): Promise<LinxupDeviceReviewReceipt> {
  const { device, currentReview } = currentDevice(input, mapReader);
  const mode = linxupControlMode();
  const evidence = {
    date: input.date,
    truck: input.truck,
    disposition: input.disposition,
    sourceObservationKey: device.observationKey,
    freshness: device.freshness,
    deliveryMode: device.deliveryMode,
    lastGpsUpdate: device.lastGpsUpdate || null,
    mappingStatus: device.mappingStatus,
    hasVerifiedCoordinate: device.hasVerifiedCoordinate,
  };
  if (mode === "preview_simulation") {
    return {
      mode,
      recordId: currentReview?.recordId || "preview-simulation",
      truck: input.truck,
      changed: true,
      verified: true,
      summary: "Preview simulation verified; no LinxUp review, telemetry, mapping, or truck state was changed.",
      evidence,
    };
  }
  const record = saveLinxupDeviceReview({
    truck: input.truck,
    disposition: input.disposition,
    note: input.note,
    sourceDate: input.date,
    sourceObservationKey: device.observationKey,
    sourceFreshness: device.freshness,
    sourceDeliveryMode: device.deliveryMode,
    sourceLastGpsUpdate: device.lastGpsUpdate,
    sourceMappingStatus: device.mappingStatus,
    sourceHasCoordinates: device.hasVerifiedCoordinate,
    updatedBy: actorLabel,
  }, {
    storeUpdatedAt: input.expectedStoreUpdatedAt,
    recordUpdatedAt: input.expectedRecordUpdatedAt,
  });
  return {
    mode,
    recordId: record.recordId,
    truck: record.truck,
    changed: true,
    verified: true,
    summary: `${record.truck} LinxUp device review verified in OpsCenter.`,
    evidence: { ...evidence, recordId: record.recordId, updatedAt: record.updatedAt },
  };
}

export async function verifyLinxupDeviceReview(
  receipt: LinxupDeviceReviewReceipt,
  input: LinxupDeviceReviewInput,
): Promise<ActionVerification> {
  if (receipt.mode === "preview_simulation") {
    return { outcome: "verified", verifiedAt: new Date().toISOString(), summary: receipt.summary, evidence: receipt.evidence };
  }
  const record = linxupDeviceReviewRecord(input.truck);
  if (
    !record
    || record.recordId !== receipt.recordId
    || record.disposition !== input.disposition
    || record.note !== input.note
    || record.sourceObservationKey !== input.expectedObservationKey
  ) {
    return { outcome: "mismatch", summary: "The LinxUp device review does not match the approved disposition and source evidence." };
  }
  return { outcome: "verified", verifiedAt: record.updatedAt, summary: receipt.summary, evidence: receipt.evidence };
}
