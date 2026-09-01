import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FleetMapPayload, FleetTruckMapRecord } from "@/lib/fleet-map";
import {
  executeLinxupDeviceReview,
  readLinxupControlSnapshot,
  verifyLinxupDeviceReview,
  type LinxupMapReader,
} from "@/lib/linxup-control";
import { readLinxupDeviceReviewStore } from "@/lib/linxup-control-store";

function digest(file: string): string {
  return fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "missing";
}

function device(overrides: Partial<FleetTruckMapRecord> = {}): FleetTruckMapRecord {
  return {
    truck: "Truck# 2",
    freshnessLabel: "GPS Stale",
    lastGpsUpdate: "2026-09-01T13:00:00.000Z",
    gpsDeliveryMode: "v2_poll_fallback",
    gpsFallbackActive: true,
    latestV3PositionAt: "2026-09-01T12:45:00.000Z",
    mappingStatus: "Mapped",
    hasCoordinates: true,
    ...overrides,
  } as FleetTruckMapRecord;
}

function mapReader(record = device()): LinxupMapReader {
  return (date) => ({
    date,
    isToday: true,
    viewMode: "daily",
    gpsDataStatus: "Partial GPS",
    lastUpdatedAt: "2026-09-01T13:00:00.000Z",
    staleThresholdMinutes: 120,
    trucksWithCoordinates: record.hasCoordinates ? 1 : 0,
    trucksWithoutCoordinates: record.hasCoordinates ? [] : [record.truck],
    routeHistoryAvailable: true,
    selectedTruck: record.truck,
    selectedTruckRecord: record,
    trucks: [record],
    mappingWarnings: [],
  } as FleetMapPayload);
}

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-linxup-control-"));
  const storeFile = path.join(temporaryDirectory, "linxup_device_reviews.json");
  process.env.LINXUP_DEVICE_REVIEW_FILE = storeFile;

  try {
    process.env.OPSCENTER_RUNTIME = "MISSION_CONTROL";
    const initial = readLinxupControlSnapshot("2026-09-01", mapReader());
    assert.equal(initial.mode, "live_control");
    assert.equal(initial.summary.devices, 1);
    assert.equal(initial.summary.stale, 1);
    assert.equal(initial.summary.fallback, 1);
    assert.equal(initial.summary.reviewNeeded, 1);
    assert.equal(initial.summary.reviewed, 0);
    assert.equal(initial.devices[0].review, null);
    assert.equal(initial.devices[0].reviewCurrent, false);
    assert.match(initial.devices[0].observationKey, /^[0-9a-f]{64}$/);
    assert.match(initial.devices[0].attentionReason, /out of date/);

    const input = {
      date: "2026-09-01",
      truck: "Truck# 2",
      disposition: "provider_follow_up" as const,
      note: "Provider follow-up is required for the stale V3 push lane.",
      expectedStoreUpdatedAt: initial.storeUpdatedAt,
      expectedRecordUpdatedAt: "",
      expectedObservationKey: initial.devices[0].observationKey,
    };
    const receipt = await executeLinxupDeviceReview(input, "Fleet manager", mapReader());
    assert.equal(receipt.mode, "live_control");
    assert.equal((await verifyLinxupDeviceReview(receipt, input)).outcome, "verified");
    const store = readLinxupDeviceReviewStore();
    assert.equal(store.records.length, 1);
    assert.equal(store.records[0].disposition, "provider_follow_up");
    assert.equal(store.records[0].sourceDeliveryMode, "v2_poll_fallback");
    assert.equal(store.audit.length, 1);

    const reviewed = readLinxupControlSnapshot("2026-09-01", mapReader());
    assert.equal(reviewed.summary.reviewed, 1);
    assert.equal(reviewed.devices[0].reviewCurrent, true);
    assert.equal(reviewed.devices[0].review?.updatedBy, "Fleet manager");

    const changedEvidence = readLinxupControlSnapshot("2026-09-01", mapReader(device({ lastGpsUpdate: "2026-09-01T13:05:00.000Z" })));
    assert.equal(changedEvidence.summary.reviewed, 0);
    assert.equal(changedEvidence.devices[0].reviewCurrent, false);
    await assert.rejects(executeLinxupDeviceReview({
      ...input,
      expectedStoreUpdatedAt: reviewed.storeUpdatedAt,
      expectedRecordUpdatedAt: reviewed.devices[0].review?.updatedAt || "",
    }, "Fleet manager", mapReader(device({ lastGpsUpdate: "2026-09-01T13:05:00.000Z" }))), /device evidence changed/);

    process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";
    const beforePreview = digest(storeFile);
    const previewReceipt = await executeLinxupDeviceReview({
      ...input,
      disposition: "monitor",
      note: "Continue monitoring while the provider reviews the push lane.",
      expectedStoreUpdatedAt: reviewed.storeUpdatedAt,
      expectedRecordUpdatedAt: reviewed.devices[0].review?.updatedAt || "",
    }, "Preview manager", mapReader());
    assert.equal(previewReceipt.mode, "preview_simulation");
    assert.equal((await verifyLinxupDeviceReview(previewReceipt, {
      ...input,
      disposition: "monitor",
      note: "Continue monitoring while the provider reviews the push lane.",
      expectedStoreUpdatedAt: reviewed.storeUpdatedAt,
      expectedRecordUpdatedAt: reviewed.devices[0].review?.updatedAt || "",
    })).outcome, "verified");
    assert.equal(digest(storeFile), beforePreview);

    console.log("LinxUp device snapshot, per-device truth, governed review, stale-evidence rejection, audit, and preview-isolation checks passed.");
  } finally {
    delete process.env.LINXUP_DEVICE_REVIEW_FILE;
    delete process.env.OPSCENTER_RUNTIME;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
