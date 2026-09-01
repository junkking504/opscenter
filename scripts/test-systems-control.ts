import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildSystemsControlSnapshot,
  executeSystemsIntegrationReview,
  verifySystemsIntegrationReview,
  type SystemsControlSources,
} from "@/lib/systems-control";
import { readSystemsIntegrationReviewStore } from "@/lib/systems-control-store";
import { validateSystemsIntegrationReview } from "@/lib/platform/actions/systems";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-systems-control-"));
const liveStore = path.join(temporary, "live", "integration_reviews.json");
const previewStore = path.join(temporary, "preview", "integration_reviews.json");
const savedRuntime = process.env.OPSCENTER_RUNTIME;
const savedStore = process.env.SYSTEMS_INTEGRATION_REVIEW_FILE;

const now = new Date("2026-09-01T14:00:00.000Z");
const sources = {
  now,
  kernel: { enabled: true, healthy: true, status: "healthy", runtime: "MAC_MINI_PREVIEW", databaseName: "opscenter_preview", migrationVersion: "0001_kernel.sql" },
  readiness: {
    ok: false,
    status: "attention",
    auth: { ok: true, identityConfigured: true, passwordHashConfigured: true, sessionSecretConfigured: true },
    photoQueue: {
      ok: false,
      counts: { incoming: 0, processing: 0, completed: 12, review: 0, failed: 1 },
      reasons: { "failed:upstream_timeout": 1 },
    },
    crewPortalSync: { ok: true, status: "synchronized", lastAttemptAt: "2026-09-01T13:58:00.000Z", lastSuccessAt: "2026-09-01T13:58:00.000Z", error: null },
  },
  dispatch: {
    date: "2026-09-01",
    mode: "live_control",
    source: "JunkWare verified schedule",
    sourceObservedAt: "2026-09-01T13:59:00.000Z",
    appointments: [{ appointmentId: "1" }],
    trucks: [],
  },
  linxup: {
    date: "2026-09-01",
    mode: "live_control",
    source: "LinxUp telemetry + verified vehicle map + OpsCenter review records",
    sourceObservedAt: "2026-09-01T13:59:30.000Z",
    storeUpdatedAt: "",
    gpsDataStatus: "V2 polling fallback active",
    devices: [],
    mappingWarnings: [],
    summary: { devices: 9, live: 8, stale: 0, offline: 0, missingCoordinate: 0, fallback: 1, reviewNeeded: 1, reviewed: 0 },
    authorityNotice: "",
  },
  finance: {
    date: "2026-09-01",
    mode: "live_control",
    source: "Truck Records + JunkWare payments + QuickBooks Online",
    sourceObservedAt: "2026-09-01T12:00:00.000Z",
    employees: [],
    paymentReconciliation: {
      status: "not_collected",
      summary: { junkware_count: 0, junkware_total: 0, merchant_center_count: 0, merchant_center_total: 0, matched_count: 0, matched_total: 0, tip_total: 0, missing_in_merchant_center_count: 0, merchant_center_only_count: 0, ambiguous_count: 0, amount_mismatch_count: 0, exception_count: 0, net_difference: 0, processing_fees: 0 },
      exceptionCount: 0,
      exceptions: [],
      reviewStoreUpdatedAt: "",
      currentReviewCount: 0,
      generatedAt: "",
      merchantCenterAvailable: false,
      merchantCenterFresh: false,
      merchantCenterCollectedAt: null,
      merchantSourceName: "QuickBooks Online",
      merchantCollector: "qbo",
    },
    manualBonuses: { count: 0, totalAmount: 0, storeUpdatedAt: "" },
    payrollCorrections: { count: 0, storeUpdatedAt: "" },
    authorityNotice: "",
  },
  communications: {
    date: "2026-09-01",
    mode: "live_control",
    source: "Slack delivery state + WhatsApp durable queues + Podium Reviews",
    sourceObservedAt: "2026-09-01T13:55:00.000Z",
    slack: { enabled: true, credentialAvailable: true, commandChannelConfigured: true, stateUpdatedAt: "2026-09-01T13:55:00.000Z", activeIncidents: 0, deliveredToday: 2 },
    whatsapp: {
      photos: { incoming: 0, processing: 0, completed: 12, review: 0, failed: 1 },
      photoConfirmations: { pending: 0, delivered: 12 },
      slackPhotoBatches: { pending: 0, delivered: 4 },
      expenses: { pending: 0, processing: 0, completed: 2, failed: 0, review: 0 },
      replies: { pending: 0, processing: 0, sent: 2, failed: 0 },
    },
    podium: { connected: false, scopes: ["read_reviews", "read_locations"], snapshotFetchedAt: "2026-09-01T13:55:00.000Z", locations: 4, recentNeedsResponse: 3, recentLowRatings: 0, pendingAttribution: 2, newToday: 1 },
    authorityNotice: "",
  },
  marketing: {
    date: "2026-09-01",
    mode: "live_control",
    source: "Podium Reviews + JunkWare completed appointments",
    sourceObservedAt: "2026-09-01T13:55:00.000Z",
    podium: { connected: false, scopes: ["read_reviews", "read_locations"], snapshotAvailable: true, snapshotFetchedAt: "2026-09-01T13:55:00.000Z", locations: 4, pendingAttribution: 2, recentNeedsResponse: 3, assignmentStoreUpdatedAt: "", reviews: [], assignmentOptions: [] },
    authorityNotice: "",
  },
  searchKings: {
    version: 1,
    source: "searchkings_reports_api",
    fetchedAt: "2026-09-01T13:50:00.000Z",
    customerId: "test",
    range: { startDate: "2026-09-01", endDate: "2026-09-01", timezone: "America/Chicago" },
    accounts: [{ id: "a", name: "Baton Rouge", type: "google_ads", metrics: [] }],
    calls: { callsQuality: [], calls: [{ id: 1 }] },
  },
} as unknown as SystemsControlSources;

async function main() {
try {
  process.env.OPSCENTER_RUNTIME = "MISSION_CONTROL";
  process.env.SYSTEMS_INTEGRATION_REVIEW_FILE = liveStore;
  const snapshot = buildSystemsControlSnapshot("2026-09-01", sources);
  assert.equal(snapshot.integrations.length, 10);
  assert.deepEqual(snapshot.summary, { integrations: 10, healthy: 6, degraded: 2, attention: 1, unavailable: 1, reviewed: 0 });
  assert.equal(snapshot.integrations.find((lane) => lane.integrationId === "linxup_delivery")?.status, "degraded");
  assert.equal(snapshot.integrations.find((lane) => lane.integrationId === "qbo_reconciliation")?.status, "unavailable");
  assert.equal(snapshot.integrations.find((lane) => lane.integrationId === "whatsapp_job_photos")?.status, "attention");

  const integration = snapshot.integrations.find((lane) => lane.integrationId === "qbo_reconciliation")!;
  const input = validateSystemsIntegrationReview({
    date: snapshot.date,
    integrationId: integration.integrationId,
    disposition: "credential_follow_up",
    owner: "Finance manager",
    nextAction: "Verify the approved QBO connection and refresh reconciliation.",
    note: "Current source reports that merchant collection is unavailable.",
    expectedReviewStoreUpdatedAt: snapshot.reviewStoreUpdatedAt,
    expectedReviewUpdatedAt: "",
    expectedObservationKey: integration.observationKey,
  });
  const receipt = await executeSystemsIntegrationReview(input, "Test approver", async () => snapshot);
  assert.equal(receipt.mode, "live_control");
  assert.equal(receipt.verified, true);
  assert.equal((await verifySystemsIntegrationReview(receipt, input)).outcome, "verified");
  const store = readSystemsIntegrationReviewStore();
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].owner, "Finance manager");
  assert.equal(store.audit.length, 1);

  assert.throws(() => validateSystemsIntegrationReview({
    ...input,
    note: "token=do-not-store",
  }), /cannot contain credentials/);

  await assert.rejects(() => executeSystemsIntegrationReview({
    ...input,
    expectedReviewUpdatedAt: store.records[0].updatedAt,
    expectedReviewStoreUpdatedAt: store.updatedAt,
    expectedObservationKey: "0".repeat(64),
  }, "Test approver", async () => ({ ...snapshot, reviewStoreUpdatedAt: store.updatedAt })), /evidence changed/);

  process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";
  process.env.SYSTEMS_INTEGRATION_REVIEW_FILE = previewStore;
  const previewSnapshot = buildSystemsControlSnapshot("2026-09-01", sources);
  const previewIntegration = previewSnapshot.integrations.find((lane) => lane.integrationId === "junkware_schedule")!;
  const previewInput = validateSystemsIntegrationReview({
    date: previewSnapshot.date,
    integrationId: previewIntegration.integrationId,
    disposition: "monitor",
    owner: "Dispatch manager",
    nextAction: "Continue monitoring the verified JunkWare schedule.",
    note: "The current schedule observation is fresh and available.",
    expectedReviewStoreUpdatedAt: "",
    expectedReviewUpdatedAt: "",
    expectedObservationKey: previewIntegration.observationKey,
  });
  const previewReceipt = await executeSystemsIntegrationReview(previewInput, "Preview approver", async () => previewSnapshot);
  assert.equal(previewReceipt.mode, "preview_simulation");
  assert.equal(fs.existsSync(previewStore), false, "Preview simulation must not create the systems review store.");
  console.log("Systems control checks passed.");
} finally {
  if (savedRuntime === undefined) delete process.env.OPSCENTER_RUNTIME;
  else process.env.OPSCENTER_RUNTIME = savedRuntime;
  if (savedStore === undefined) delete process.env.SYSTEMS_INTEGRATION_REVIEW_FILE;
  else process.env.SYSTEMS_INTEGRATION_REVIEW_FILE = savedStore;
  fs.rmSync(temporary, { recursive: true, force: true });
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
