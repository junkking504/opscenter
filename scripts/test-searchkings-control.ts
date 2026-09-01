import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateSearchKingsRecovery } from "../lib/platform/actions/searchkings";
import {
  buildSearchKingsControlSnapshot,
  executeSearchKingsRecovery,
  prepareSearchKingsRecoveryInput,
  verifySearchKingsRecovery,
} from "../lib/searchkings-control";
import {
  buildSearchKingsViewFromData,
  readLostLeadStore,
  type SearchKingsSnapshot,
} from "../lib/searchkings";

async function main() {
const taskDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-searchkings-control-"));
const storeFile = path.join(taskDirectory, "lost-leads.json");
process.env.SEARCHKINGS_LOST_LEAD_STORE = storeFile;

const source: SearchKingsSnapshot = {
  version: 1,
  source: "searchkings_reports_api",
  fetchedAt: "2026-08-31T15:00:00.000Z",
  customerId: "test-customer",
  range: { startDate: "2026-08-30", endDate: "2026-08-31", timezone: "America/Chicago" },
  accounts: [],
  calls: {
    total: { currentCalls: 1, currentScoredCalls: 1 },
    callsQuality: [],
    calls: [{
      id: "source-call-1",
      name: "Recovery Caller",
      callerNumberComplete: "+1 225 555 0199",
      city: "Baton Rouge",
      state: "LA",
      source: "Google Ads",
      score: 5,
      tagList: ["Availability"],
      reportingTag: "Quoted $325. Call back at (225) 555-0199.",
      trackingLabel: "Baton Rouge",
      duration: "02:15",
      calledAtDate: "2026-08-30",
      calledAtTime: "9:00 AM",
    }],
  },
};

const view = buildSearchKingsViewFromData(source, [], [], new Date("2026-09-03T18:00:00.000Z"));
const snapshot = buildSearchKingsControlSnapshot("2026-09-01", view, readLostLeadStore());
assert.equal(snapshot.summary.lost, 1);
assert.equal(snapshot.recoveryLeads.length, 1);
assert.equal(snapshot.recoveryLeads[0]?.potentialRevenue, 325);
assert.doesNotMatch(JSON.stringify(snapshot), /2255550199|225\) 555-0199/);
assert.match(snapshot.authorityNotice, /never calls or messages a customer/);

const lead = snapshot.recoveryLeads[0]!;
const prepared = prepareSearchKingsRecoveryInput("2026-09-01", lead.callId, {
  status: "lost",
  reason: "availability",
  owner: "Sales manager",
  nextAction: "Review availability coverage before the next campaign window.",
  evidenceNote: "Call outcome and current JunkWare no-match were reviewed.",
  franchiseContacted: false,
}, () => snapshot);
assert.deepEqual(validateSearchKingsRecovery(prepared), prepared);
assert.throws(() => validateSearchKingsRecovery({ ...prepared, status: "booked" }), /JunkWare evidence determines/);
assert.throws(() => validateSearchKingsRecovery({ ...prepared, owner: "manager@example.com" }), /contact details/);

process.env.OPSCENTER_RUNTIME = "MAC_MINI_PREVIEW";
const previewReceipt = await executeSearchKingsRecovery(prepared, "Manager", () => snapshot);
assert.equal(previewReceipt.mode, "preview_simulation");
assert.equal(fs.existsSync(storeFile), false);
assert.equal((await verifySearchKingsRecovery(previewReceipt, prepared)).outcome, "verified");

process.env.OPSCENTER_RUNTIME = "MISSION_CONTROL";
const liveReceipt = await executeSearchKingsRecovery(prepared, "Approving Manager", () => snapshot);
assert.equal(liveReceipt.mode, "live_control");
assert.equal(readLostLeadStore().entries[0]?.owner, "Sales manager");
assert.equal((await verifySearchKingsRecovery(liveReceipt, prepared)).outcome, "verified");

await assert.rejects(
  () => executeSearchKingsRecovery(prepared, "Manager", () => ({ ...snapshot, sourceObservedAt: "2026-09-01T16:00:00.000Z" })),
  /VERSION_CONFLICT/,
);

fs.rmSync(taskDirectory, { recursive: true, force: true });
delete process.env.SEARCHKINGS_LOST_LEAD_STORE;
delete process.env.OPSCENTER_RUNTIME;

console.log("SearchKings governed recovery checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
