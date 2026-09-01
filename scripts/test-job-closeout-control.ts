import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { WorkItem } from "@/lib/platform/contracts";
import {
  decorateJobCloseoutResult,
  executeJobCloseout,
  jobCloseoutObservationKey,
} from "@/lib/job-closeout-control";
import { registeredActionDefinition } from "@/lib/platform/actions/registry";
import { decideActionPolicy } from "@/lib/platform/actions/policy";

process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";

async function main(): Promise<void> {

const closeout = {
  status: { value: "8", label: "Completed" },
  driver: { value: "crew-1", label: "Driver One" },
  drivers: [{ value: "crew-1", label: "Driver One" }],
  navigators: [{ value: "crew-2", label: "Navigator Two" }],
  navigatorOptions: [{ value: "crew-2", label: "Navigator Two" }],
  loadQuantity: "1",
  loadSize: { value: "full", label: "Full", options: [{ value: "full", label: "Full" }] },
  loadPrice: "500.00",
  bedloadQuantity: "",
  bedloadSize: { value: "", label: "None", options: [{ value: "", label: "None" }] },
  bedloadPrice: "",
  otherChargeOptions: [],
  otherCharges: [],
  discount: "0.00",
  tip: "25.00",
  jobCategory: { value: "residential", label: "Residential", options: [{ value: "residential", label: "Residential" }] },
  actualStartHour: { value: "9", label: "9 AM", options: [{ value: "9", label: "9 AM" }] },
  actualStartMinute: { value: "0", label: "00", options: [{ value: "0", label: "00" }] },
  actualEndHour: { value: "10", label: "10 AM", options: [{ value: "10", label: "10 AM" }] },
  actualEndMinute: { value: "30", label: "30", options: [{ value: "30", label: "30" }] },
  paymentMethods: [{ value: "cash", label: "Cash" }],
  payments: [],
  balance: "500.00",
  total: "$500.00",
};

const observationKey = jobCloseoutObservationKey(closeout);
assert.match(observationKey, /^[0-9a-f]{64}$/);
assert.equal(jobCloseoutObservationKey({ ...closeout, tip: "30.00" }) === observationKey, false);
const decorated = decorateJobCloseoutResult({ ok: true, closeout, verifiedAt: "2026-09-01T12:00:00.000Z" });
assert.equal(decorated.observationKey, observationKey);
assert.equal(decorated.controlMode, "preview_simulation");

const action = registeredActionDefinition("jobs.update_closeout.v1");
assert.ok(action);
assert.equal(action.riskClass, 3);
assert.equal(action.requiredPermission, "sensitive.write");
assert.equal(decideActionPolicy(action, {
  id: "actor_manager",
  kind: "human",
  externalIdentity: "manager@example.com",
  displayName: "Manager",
  roles: [{ role: "manager", resourceScope: "*" }],
}).decision.outcome, "approval_required");

const validated = action.validateInput({
  appointmentId: "4056261",
  serviceDate: "2026-09-01",
  sourceObservedAt: "2026-09-01T12:00:00.000Z",
  expectedObservationKey: observationKey,
  workItemId: "work_closeout",
  expectedWorkItemVersion: 3,
  closeout: {
    driverId: "crew-1",
    navigatorIds: ["crew-2"],
    loadQuantity: "1.0",
    loadSize: "full",
    loadPrice: "$500",
    bedloadQuantity: "",
    bedloadSize: "",
    bedloadPrice: "",
    otherChargesToAdd: [],
    discount: "0",
    tip: "25",
    jobCategoryId: "residential",
    actualStartHour: "9",
    actualStartMinute: "0",
    actualEndHour: "10",
    actualEndMinute: "30",
    addPayment: { methodId: "cash", amount: "500" },
  },
});
assert.equal(validated.closeout.loadPrice, "500.00");
assert.equal(validated.closeout.addPayment?.amount, "500.00");
assert.throws(() => action.validateInput({ ...validated, closeout: { ...validated.closeout, navigatorIds: ["crew-1"] } }), /unique/);

const workItem: WorkItem = {
  id: "work_closeout",
  dedupeKey: "2026-09-01|Jobs|payment_amount_present_but_payment_type_missing|job|4056261",
  operatingDate: "2026-09-01",
  rule: "payment_amount_present_but_payment_type_missing",
  category: "Jobs",
  severity: "warning",
  entity: { type: "job", id: "4056261", label: "JK123" },
  title: "Payment type missing",
  description: "Payment exists without a method.",
  source: "daily_metrics.appointments",
  sourceObservedAt: "2026-09-01T12:00:00.000Z",
  status: "open",
  firstDetectedAt: "2026-09-01T12:00:00.000Z",
  lastDetectedAt: "2026-09-01T12:00:00.000Z",
  version: 3,
};
let adapterReads = 0;
let adapterWrites = 0;
const receipt = await executeJobCloseout(validated, "Manager", {
  workItemReader: async () => workItem,
  adapter: async (_appointmentId, payload) => {
    if (payload) adapterWrites += 1;
    else adapterReads += 1;
    return { ok: true, closeout, verifiedAt: "2026-09-01T12:00:00.000Z" };
  },
});
assert.equal(receipt.mode, "preview_simulation");
assert.equal(receipt.changed, false);
assert.equal(receipt.verified, true);
assert.equal(adapterReads, 1);
assert.equal(adapterWrites, 0);
assert.match(receipt.summary, /no closeout, payment, truck-load, or Slack state changed/i);

const adapterSource = readFileSync(path.join(process.cwd(), "scripts/sync-junkware-job-closeout.ts"), "utf8");
for (const verificationContract of [
  "[\"loadSize\", input.loadSize, \"load size\"]",
  "[\"jobCategory\", input.jobCategoryId, \"job category\"]",
  "removePriorRows(before.otherCharges, closeout.otherCharges",
  "JunkWare did not retain the requested payment method and amount.",
]) {
  assert.ok(adapterSource.includes(verificationContract), `Closeout adapter is missing exact read-back verification: ${verificationContract}`);
}

await assert.rejects(() => executeJobCloseout({ ...validated, expectedObservationKey: "0".repeat(64) }, "Manager", {
  workItemReader: async () => workItem,
  adapter: async () => ({ ok: true, closeout, verifiedAt: "2026-09-01T12:00:00.000Z" }),
}), /VERSION_CONFLICT/);

console.log("Governed JunkWare closeout validation, observation locking, approval policy, and preview nonmutation passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
