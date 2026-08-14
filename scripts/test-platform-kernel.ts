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
import {
  attentionBucketForWorkItem,
  dueAtForRule,
  inboxRulePolicy,
  INBOX_RULES,
  parseManualWorkItemRequest,
} from "../lib/platform/work-policy";

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

assert.equal(INBOX_RULES.size, 15);
assert.equal(INBOX_RULES.has("employee_clocked_in_but_not_assigned_to_truck"), true);
assert.equal(INBOX_RULES.has("gps_timestamp_older_than_20_minutes"), true);
assert.match(inboxRulePolicy("payment_amount_present_but_payment_type_missing").recommendedAction, /payment method/i);
assert.equal(
  dueAtForRule("open_appointment_past_scheduled_window", new Date("2026-08-14T20:00:00.000Z")),
  "2026-08-14T20:15:00.000Z",
);
assert.equal(attentionBucketForWorkItem({ status: "open", severity: "critical" }), "act_now");
assert.equal(attentionBucketForWorkItem({ status: "snoozed", severity: "critical" }), "waiting");
assert.equal(attentionBucketForWorkItem({ status: "resolved", severity: "critical" }), "resolved");
assert.equal(attentionBucketForWorkItem({
  status: "open",
  severity: "warning",
  dueAt: "2026-08-14T19:00:00.000Z",
}, new Date("2026-08-14T20:00:00.000Z")), "act_now");

assert.deepEqual(parseManualWorkItemRequest({
  title: "Call customer about access",
  description: "Confirm gate access before the truck arrives.",
  category: "Jobs",
  severity: "warning",
  relatedRecord: "JK4052118",
  dueAt: "2026-08-14T22:00:00.000Z",
  assignToSelf: true,
}, new Date("2026-08-14T20:00:00.000Z")), {
  title: "Call customer about access",
  description: "Confirm gate access before the truck arrives.",
  category: "Jobs",
  severity: "warning",
  relatedRecord: "JK4052118",
  dueAt: "2026-08-14T22:00:00.000Z",
  assignToSelf: true,
});
assert.throws(() => parseManualWorkItemRequest({
  title: "No",
  description: "Valid description",
  category: "Jobs",
  severity: "warning",
}, new Date("2026-08-14T20:00:00.000Z")), /Title must be at least 3 characters/);

console.log("Platform kernel contracts verified.");
