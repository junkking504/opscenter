import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    { appt_id: "1", job_id: "JK4051001", job_status: "Completed", appointment_time: "9:00 AM", truck: "Truck 6", market: "Baton Rouge" },
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
assert.match(String(events.find((event) => event.kind === "rescheduled")?.alert.detail), /Previous: 10:00 AM/);
assert.deepEqual(detectScheduleChanges(null, current), []);

async function verifyScopedPublishing() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-schedule-state-"));
  const originalFetch = globalThis.fetch;
  try {
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
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

verifyScopedPublishing().then(() => {
  console.log("JunkWare schedule change detector tests passed.");
});
