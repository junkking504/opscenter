import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isTruckCloseoutDelivered, recordDeliveredTruckCloseout } from "@/lib/slack-alerts";
import { detectScheduleChanges, publishScheduleChanges } from "@/lib/junkware-schedule-changes";

process.env.SLACK_TRUCK_6_CHANNEL_ID = "C_TEST_TRUCK_6";

const previous = {
  date: "2026-08-17",
  scrapedAt: "2026-08-17T16:00:00-05:00",
  appointments: [
    { appt_id: "1", job_id: "JK4051001", job_status: "Scheduled", appointment_time: "9:00 AM", truck: "Truck 6", market: "Baton Rouge" },
    { appt_id: "2", job_id: "JK4051002", job_status: "Scheduled", appointment_time: "10:00 AM", truck: "Truck 1", market: "New Orleans" },
  ],
  cancelled: [],
};

const current = {
  date: "2026-08-17",
  scrapedAt: "2026-08-17T16:01:00-05:00",
  appointments: [
    { appt_id: "1", job_id: "JK4051001", job_status: "Completed", appointment_time: "9:00 AM", truck: "Truck 6", market: "Baton Rouge", revenue: "$225.00", payment_type: "Cash" },
    { appt_id: "2", job_id: "JK4051002", job_status: "Scheduled", appointment_time: "11:00 AM", truck: "Truck 1", market: "New Orleans" },
    { appt_id: "3", job_id: "JK4051003", job_status: "Scheduled", appointment_time: "1:00 PM", truck: "Truck 4", market: "Northshore" },
  ],
  cancelled: [
    { appt_id: "4", job_id: "JK4051004", job_status: "Cancelled", appointment_time: "2:00 PM", market: "Baton Rouge" },
  ],
};

const events = detectScheduleChanges(previous, current);
assert.deepEqual(events.map((event) => event.kind).sort(), ["cancelled", "job_closed", "new_appointment", "rescheduled"]);
assert.equal(events.find((event) => event.kind === "job_closed")?.alert.channelId, "C_TEST_TRUCK_6");
assert.equal(events.find((event) => event.kind === "job_closed")?.alert.plainText, ":white_check_mark: JK4051001 closed out. Job total: $225.00. Tip: $0.00. Charged: Cash ($225.00).");
assert.match(String(events.find((event) => event.kind === "rescheduled")?.alert.detail), /Previous: 10:00 AM/);
assert.deepEqual(detectScheduleChanges(null, current), []);

async function verifyScopedPublishing() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-schedule-state-"));
  const originalFetch = globalThis.fetch;
  const originalStateFile = process.env.SLACK_OPSCENTER_STATE_FILE;
  try {
    process.env.SLACK_OPSCENTER_STATE_FILE = path.join(tempDir, "slack", "ops_alert_state.json");
    fs.mkdirSync(path.join(tempDir, "slack"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "slack", "junkware_schedule_change_state.json"),
      JSON.stringify({ version: 1, snapshot: previous, delivered: ["legacy-event"] }),
    );
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
    const [market352Baseline, market477Baseline] = await Promise.all([
      publishScheduleChanges(tempDir, previous, "xoxb-test", { scope: "market-352" }),
      publishScheduleChanges(tempDir, current, "xoxb-test", { scope: "market-477" }),
    ]);
    assert.equal(market352Baseline.baselined, true);
    assert.equal(market477Baseline.baselined, true);

    const market352Change = await publishScheduleChanges(tempDir, current, "xoxb-test", { scope: "market-352" });
    assert.equal(market352Change.baselined, false);
    assert.deepEqual(market352Change.posted.map((event) => event.kind).sort(), ["cancelled", "job_closed", "new_appointment", "rescheduled"]);

    const state = JSON.parse(fs.readFileSync(path.join(tempDir, "slack", "junkware_schedule_change_state.json"), "utf8"));
    assert.equal(state.version, 2);
    assert.ok(state.snapshots.legacy);
    assert.ok(state.snapshots["market-352"]);
    assert.ok(state.snapshots["market-477"]);
    assert.ok(isTruckCloseoutDelivered("2026-08-17", "job_closed:2026-08-17:appt-1"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStateFile === undefined) delete process.env.SLACK_OPSCENTER_STATE_FILE;
    else process.env.SLACK_OPSCENTER_STATE_FILE = originalStateFile;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function verifyNormalCloseoutSuppressesDetector() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-schedule-shared-dedupe-"));
  const originalFetch = globalThis.fetch;
  const originalStateFile = process.env.SLACK_OPSCENTER_STATE_FILE;
  try {
    process.env.SLACK_OPSCENTER_STATE_FILE = path.join(tempDir, "slack", "ops_alert_state.json");
    recordDeliveredTruckCloseout("2026-08-17", "job_closed:2026-08-17:appt-1");
    let posts = 0;
    globalThis.fetch = async () => {
      posts += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    await publishScheduleChanges(tempDir, previous, "xoxb-test", { scope: "normal-closeout" });
    const result = await publishScheduleChanges(tempDir, current, "xoxb-test", { scope: "normal-closeout" });
    assert.deepEqual(result.posted.map((event) => event.kind).sort(), ["cancelled", "new_appointment", "rescheduled"]);
    assert.equal(posts, 3);
    const state = JSON.parse(fs.readFileSync(path.join(tempDir, "slack", "junkware_schedule_change_state.json"), "utf8"));
    assert.ok(state.delivered.includes("job_closed:2026-08-17:appt-1"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStateFile === undefined) delete process.env.SLACK_OPSCENTER_STATE_FILE;
    else process.env.SLACK_OPSCENTER_STATE_FILE = originalStateFile;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

verifyScopedPublishing().then(verifyNormalCloseoutSuppressesDetector).then(() => {
  console.log("JunkWare schedule change detector tests passed.");
});
