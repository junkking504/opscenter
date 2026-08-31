import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  executeFleetOutOfService,
  executeFleetReturnToService,
  readFleetControlSnapshot,
  verifyFleetOutOfService,
  verifyFleetReturnToService,
} from "@/lib/fleet-control";
import { readFleetIssueStore, upsertFleetIssue } from "@/lib/fleet-issues";

function digest(file: string): string {
  return fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "missing";
}

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-fleet-control-"));
  const storeFile = path.join(temporaryDirectory, "repair_issues.json");
  process.env.FLEET_ISSUES_FILE = storeFile;

  try {
  process.env.OPSCENTER_RUNTIME = "MISSION_CONTROL";
  const seed = upsertFleetIssue({ truck: "Truck 2", title: "Rear door", severity: "repair_soon", status: "open" });
  assert.ok(seed);
  const seededStore = readFleetIssueStore();

  const holdReceipt = await executeFleetOutOfService({
    truck: "Truck# 3",
    reason: "Hydraulic leak at lift gate",
    expectedStoreUpdatedAt: seededStore.updatedAt,
  });
  assert.equal(holdReceipt.mode, "live_control");
  assert.equal((await verifyFleetOutOfService(holdReceipt, {
    truck: "Truck# 3",
    reason: "Hydraulic leak at lift gate",
    expectedStoreUpdatedAt: seededStore.updatedAt,
  })).outcome, "verified");
  const heldStore = readFleetIssueStore();
  const blocker = heldStore.issues.find((issue) => issue.issueId === holdReceipt.issueId);
  assert.equal(blocker?.severity, "out_of_service");
  assert.equal(blocker?.status, "open");
  assert.ok(heldStore.updatedAt > seededStore.updatedAt);

  await assert.rejects(
    executeFleetOutOfService({ truck: "Truck# 6", reason: "Stale request", expectedStoreUpdatedAt: seededStore.updatedAt }),
    /VERSION_CONFLICT/,
  );

  const returnReceipt = await executeFleetReturnToService({
    truck: "Truck# 3",
    issueId: blocker!.issueId,
    resolution: "Lift hose replaced and pressure tested",
    expectedStoreUpdatedAt: heldStore.updatedAt,
    expectedIssueUpdatedAt: blocker!.updatedAt,
  });
  assert.equal((await verifyFleetReturnToService(returnReceipt, {
    truck: "Truck# 3",
    issueId: blocker!.issueId,
    resolution: "Lift hose replaced and pressure tested",
    expectedStoreUpdatedAt: heldStore.updatedAt,
    expectedIssueUpdatedAt: blocker!.updatedAt,
  })).outcome, "verified");
  assert.equal(readFleetIssueStore().issues.find((issue) => issue.issueId === blocker!.issueId)?.status, "resolved");

  const firstBlocker = upsertFleetIssue({ truck: "Truck# 4", title: "Brake warning", severity: "out_of_service", status: "open" });
  const secondBlocker = upsertFleetIssue({ truck: "Truck# 4", title: "Tire damage", severity: "out_of_service", status: "open" });
  assert.ok(firstBlocker && secondBlocker);
  const multiBlockerStore = readFleetIssueStore();
  await assert.rejects(
    executeFleetReturnToService({
      truck: "Truck# 4",
      issueId: firstBlocker.issueId,
      resolution: "Brake warning cleared",
      expectedStoreUpdatedAt: multiBlockerStore.updatedAt,
      expectedIssueUpdatedAt: firstBlocker.updatedAt,
    }),
    /every other out-of-service repair/,
  );

  const snapshot = readFleetControlSnapshot("2026-08-31");
  assert.equal(snapshot.mode, "live_control");
  assert.equal(snapshot.trucks.find((truck) => truck.truck === "Truck# 4")?.blockingIssues.length, 2);
  assert.equal(snapshot.trucks.find((truck) => truck.truck === "Truck# 3")?.blockingIssues.length, 0);

  process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";
  const previewBefore = digest(storeFile);
  const previewReceipt = await executeFleetOutOfService({
    truck: "Truck# 5",
    reason: "Preview-only suspension concern",
    expectedStoreUpdatedAt: readFleetIssueStore().updatedAt,
  });
  assert.equal(previewReceipt.mode, "preview_simulation");
  assert.equal((await verifyFleetOutOfService(previewReceipt, {
    truck: "Truck# 5",
    reason: "Preview-only suspension concern",
    expectedStoreUpdatedAt: readFleetIssueStore().updatedAt,
  })).outcome, "verified");
  assert.equal(digest(storeFile), previewBefore);

  console.log("Fleet control snapshot, stale-state, hold, return-to-service, blocker, and preview-isolation checks passed.");
  } finally {
    delete process.env.FLEET_ISSUES_FILE;
    delete process.env.OPSCENTER_RUNTIME;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
