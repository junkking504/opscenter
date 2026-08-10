import assert from "node:assert/strict";
import {
  assertActionRunTransition,
  assertWorkItemTransition,
  canTransitionActionRun,
  canTransitionWorkItem,
} from "../lib/platform/state-machines";
import { createCorrelationId, createPlatformId, workItemDedupeKey } from "../lib/platform/identifiers";
import { redactOperationalValue } from "../lib/platform/redaction";
import { resolveKernelDatabaseConfig } from "../lib/platform/persistence/config";

assert.equal(canTransitionWorkItem("open", "acknowledged"), true);
assert.equal(canTransitionWorkItem("resolved", "open"), true);
assert.equal(canTransitionWorkItem("resolved", "in_progress"), false);
assert.doesNotThrow(() => assertWorkItemTransition("in_progress", "resolved"));
assert.throws(
  () => assertWorkItemTransition("dismissed", "resolved"),
  /Invalid work item transition/,
);

assert.equal(canTransitionActionRun("requested", "awaiting_approval"), true);
assert.equal(canTransitionActionRun("verifying", "queued"), true);
assert.equal(canTransitionActionRun("succeeded", "queued"), false);
assert.doesNotThrow(() => assertActionRunTransition("running", "verifying"));
assert.throws(
  () => assertActionRunTransition("denied", "running"),
  /Invalid action run transition/,
);

assert.match(createPlatformId("work"), /^work_[0-9a-f-]{36}$/);
assert.match(createCorrelationId(), /^corr_[0-9a-f-]{36}$/);
assert.throws(() => createPlatformId("INVALID PREFIX"), /Invalid platform identifier prefix/);

assert.equal(
  workItemDedupeKey({
    operatingDate: "2026-08-10",
    category: "Jobs",
    rule: "completed_job_with_no_driver",
    entityType: "job",
    entityId: "12345",
  }),
  "2026-08-10|Jobs|completed_job_with_no_driver|job|12345",
);
assert.throws(
  () => workItemDedupeKey({
    operatingDate: "08/10/2026",
    category: "Jobs",
    rule: "completed_job_with_no_driver",
    entityType: "job",
    entityId: "12345",
  }),
  /dedupe key fields are invalid/,
);

const circular: Record<string, unknown> = { safe: "visible", token: "hidden" };
circular.self = circular;
assert.deepEqual(redactOperationalValue({
  password: "hidden",
  nested: {
    sessionCookie: "hidden",
    appointmentId: "12345",
  },
  circular,
}), {
  password: "[REDACTED]",
  nested: {
    sessionCookie: "[REDACTED]",
    appointmentId: "12345",
  },
  circular: {
    safe: "visible",
    token: "[REDACTED]",
    self: "[CIRCULAR]",
  },
});

assert.deepEqual(
  resolveKernelDatabaseConfig({}, "MAC_MINI_PREVIEW"),
  {
    status: "disabled",
    enabled: false,
    runtime: "MAC_MINI_PREVIEW",
    reason: "OPSCENTER_KERNEL_ENABLED is not set to 1.",
  },
);

const missingPreviewDatabase = resolveKernelDatabaseConfig(
  { OPSCENTER_KERNEL_ENABLED: "1" },
  "MAC_MINI_PREVIEW",
);
assert.equal(missingPreviewDatabase.status, "misconfigured");
assert.equal(
  missingPreviewDatabase.status === "misconfigured" && missingPreviewDatabase.environmentVariable,
  "OPSCENTER_PREVIEW_DATABASE_URL",
);

const unsafePreviewDatabase = resolveKernelDatabaseConfig(
  {
    OPSCENTER_KERNEL_ENABLED: "1",
    OPSCENTER_PREVIEW_DATABASE_URL: "postgresql://localhost/opscenter_production",
  },
  "MAC_MINI_PREVIEW",
);
assert.equal(unsafePreviewDatabase.status, "misconfigured");
assert.match(
  unsafePreviewDatabase.status === "misconfigured" ? unsafePreviewDatabase.reason : "",
  /must contain preview/,
);

const previewDatabase = resolveKernelDatabaseConfig(
  {
    OPSCENTER_KERNEL_ENABLED: "1",
    OPSCENTER_PREVIEW_DATABASE_URL: "postgresql://localhost/opscenter_preview",
    OPSCENTER_KERNEL_DB_POOL_MAX: "50",
  },
  "MAC_MINI_PREVIEW",
);
assert.equal(previewDatabase.status, "ready");
assert.equal(previewDatabase.status === "ready" && previewDatabase.databaseName, "opscenter_preview");
assert.equal(previewDatabase.status === "ready" && previewDatabase.maxConnections, 20);

console.log("Platform kernel contracts verified.");
