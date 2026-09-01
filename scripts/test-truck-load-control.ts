import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  executeTruckLoadReset,
  executeTruckStartingLoad,
  verifyTruckLoadReset,
  verifyTruckStartingLoad,
} from "@/lib/truck-load-control";
import { readTruckLoadStore, truckLoadStatusStorePath } from "@/lib/truck-load-status";

function digest(file: string): string {
  return fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "missing";
}

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-truck-load-control-"));
  process.env.OPSCENTER_DATA_DIR = temporaryDirectory;

  try {
    process.env.OPSCENTER_RUNTIME = "MISSION_CONTROL";
    const startingInput = {
      date: "2026-09-01",
      truck: "Truck# 4",
      loadFraction: 1 / 4,
      expectedStoreUpdatedAt: "",
    };
    const startingReceipt = await executeTruckStartingLoad(startingInput, "Test operator");
    assert.equal(startingReceipt.mode, "live_control");
    assert.equal(startingReceipt.changed, true);
    assert.equal(startingReceipt.evidence.externalWrite, false);
    assert.equal((await verifyTruckStartingLoad(startingReceipt, startingInput)).outcome, "verified");
    const startedStore = readTruckLoadStore();
    assert.equal(startedStore.events.find((event) => event.eventId === startingReceipt.eventId)?.loadFraction, 1 / 4);

    const noOpReceipt = await executeTruckStartingLoad({ ...startingInput, expectedStoreUpdatedAt: startedStore.updatedAt }, "Test operator");
    assert.equal(noOpReceipt.changed, false);
    assert.equal(readTruckLoadStore().updatedAt, startedStore.updatedAt);

    await assert.rejects(
      executeTruckStartingLoad({ ...startingInput, loadFraction: 1 / 2, expectedStoreUpdatedAt: "" }, "Test operator"),
      /VERSION_CONFLICT/,
    );

    const resetInput = {
      date: "2026-09-01",
      truck: "Truck# 4",
      location: "dump" as const,
      expectedStoreUpdatedAt: startedStore.updatedAt,
    };
    const resetReceipt = await executeTruckLoadReset(resetInput, { actionRunId: "action_test_reset", recordedBy: "Test operator" });
    assert.equal(resetReceipt.eventId, "yard-reset:action_test_reset");
    assert.equal(resetReceipt.changed, true);
    assert.equal((await verifyTruckLoadReset(resetReceipt, resetInput)).outcome, "verified");
    assert.equal(readTruckLoadStore().events.find((event) => event.eventId === resetReceipt.eventId)?.resetLocation, "dump");
    const resetRetry = await executeTruckLoadReset(resetInput, { actionRunId: "action_test_reset", recordedBy: "Test operator" });
    assert.equal(resetRetry.changed, false);
    assert.equal(resetRetry.eventId, resetReceipt.eventId);

    process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";
    const previewInput = {
      date: "2026-09-01",
      truck: "Truck# 4",
      location: "metal_yard" as const,
      expectedStoreUpdatedAt: readTruckLoadStore().updatedAt,
    };
    const storeFile = truckLoadStatusStorePath();
    const previewBefore = digest(storeFile);
    const previewReceipt = await executeTruckLoadReset(previewInput, { actionRunId: "action_preview", recordedBy: "Preview operator" });
    assert.equal(previewReceipt.mode, "preview_simulation");
    assert.equal(previewReceipt.changed, false);
    assert.equal(previewReceipt.evidence.externalWrite, false);
    assert.equal((await verifyTruckLoadReset(previewReceipt, previewInput)).outcome, "verified");
    assert.equal(digest(storeFile), previewBefore);

    console.log("Truck-load starting state, deterministic reset, stale-state, read-back, no-op, and preview-isolation checks passed.");
  } finally {
    delete process.env.OPSCENTER_DATA_DIR;
    delete process.env.OPSCENTER_RUNTIME;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
