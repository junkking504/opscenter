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
    { appt_id: "5", job_id: "JK4051005", job_status: "Scheduled", appointment_time: "3:00 PM", appointment_date: "2026-08-17", truck: "Truck 1", market: "New Orleans" },
    { appt_id: "6", job_id: "JK4051006", appointment_type: "Estimate", job_status: "Scheduled", appointment_time: "4:00 PM", truck: "Truck 6", market: "Baton Rouge" },
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
    { appt_id: "5", job_id: "JK4051005", job_status: "Scheduled", appointment_time: "3:00 PM", appointment_date: "2026-08-17", truck: "Truck 9", market: "Baton Rouge" },
    {
      appt_id: "6",
      job_id: "JK4051006",
      appointment_type: "Estimate",
      job_status: "Completed",
      appointment_time: "4:00 PM",
      truck: "Truck 6",
      market: "Baton Rouge",
      customer_name: "Estimate Customer",
      driver_normalized_name: "Estimate Driver",
      navigator_normalized_name: "Estimate Navigator",
      revenue: "$180.00",
      closeout: {
        loadSize: "1 (1/4)",
        loadPrice: "$180.00",
        tip: "",
        total: "$180.00",
        payments: [],
      },
    },
  ],
  cancelled: [
    { appt_id: "4", job_id: "JK4051004", job_status: "Cancelled", appointment_time: "2:00 PM", market: "Baton Rouge" },
  ],
};

const nextBusinessDay = {
  ...current,
  date: "2026-08-18",
  scrapedAt: "2026-08-18T08:00:00-05:00",
};

const events = detectScheduleChanges(previous, current);
assert.deepEqual(events.map((event) => event.kind).sort(), ["cancelled", "new_appointment", "rescheduled"]);
assert.deepEqual(events.find((event) => event.kind === "rescheduled")?.alert.fields, [
  { label: "Previous", value: "10:00 AM" },
  { label: "New", value: "11:00 AM" },
  { label: "Truck", value: "Truck 1" },
]);
assert.equal(
  events.find((event) => event.kind === "rescheduled")?.alert.href,
  "https://ops.junk-king.app/jobs?date=2026-08-17#job-jk4051002",
);

const truckOnlyMove = {
  ...previous,
  appointments: previous.appointments.map((appointment) =>
    appointment.appt_id === "2" ? { ...appointment, truck: "Truck 3" } : appointment,
  ),
};
assert.deepEqual(detectScheduleChanges(previous, truckOnlyMove), []);
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
    assert.deepEqual(market352Change.posted.map((event) => event.kind).sort(), ["cancelled", "new_appointment", "rescheduled"]);

    const dateRollover = await publishScheduleChanges(tempDir, nextBusinessDay, "xoxb-test", { scope: "market-352" });
    assert.equal(dateRollover.baselined, true);
    assert.deepEqual(dateRollover.posted, []);

    await publishScheduleChanges(tempDir, previous, "xoxb-test", { scope: "fast-closeout" });
    let fastChecks = 0;
    const pendingCloseout = await publishScheduleChanges(tempDir, current, "xoxb-test", {
      scope: "fast-closeout",
      resolveCloseout: async ({ row }) => {
        fastChecks += 1;
        assert.equal(row.appt_id, "1");
        return false;
      },
    });
    assert.equal(fastChecks, 1);
    assert.equal(pendingCloseout.closeoutsResolved, 0);

    const resolvedCloseout = await publishScheduleChanges(tempDir, current, "xoxb-test", {
      scope: "fast-closeout",
      resolveCloseout: async () => true,
    });
    assert.equal(resolvedCloseout.closeoutsResolved, 1);

    const state = JSON.parse(fs.readFileSync(path.join(tempDir, "slack", "junkware_schedule_change_state.json"), "utf8"));
    assert.equal(state.version, 3);
    assert.ok(state.snapshots.legacy);
    assert.ok(state.snapshots["market-352"]);
    assert.ok(state.snapshots["market-477"]);
    assert.equal(state.snapshots["market-352"]?.date, "2026-08-18");
    assert.ok(state.pendingCloseouts["market-352:2026-08-17:appt-1"]);
    assert.equal(state.pendingCloseouts["fast-closeout:2026-08-17:appt-1"], undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStateFile === undefined) delete process.env.SLACK_OPSCENTER_STATE_FILE;
    else process.env.SLACK_OPSCENTER_STATE_FILE = originalStateFile;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

verifyScopedPublishing().then(() => {
  console.log("JunkWare schedule change detector tests passed.");
});
