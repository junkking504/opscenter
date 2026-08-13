import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appointmentTerritory, buildCancelledAppointmentFeed } from "@/lib/add-on-notifications";
import {
  appointmentChannelId,
  buildPaymentCloseoutSlackNotifications,
  buildCrewSlackNotifications,
  buildTruckArrivalSlackNotifications,
  formatSlackAlert,
  runSlackOpsAlerts,
  slackAlertKindEnabled,
} from "@/lib/slack-alerts";
import { normalizeSlackTruckNumber, truckSlackChannelId } from "@/lib/slack-truck-channels";

process.env.SLACK_JOBS_NO_CHANNEL_ID = "C_TEST_NO";
process.env.SLACK_JOBS_BR_CHANNEL_ID = "C_TEST_BR";
process.env.SLACK_JOBS_NS_CHANNEL_ID = "C_TEST_NS";
process.env.SLACK_OPS_DISPATCH_CHANNEL_ID = "C_TEST_DISPATCH";
process.env.SLACK_OPS_COMMAND_CHANNEL_ID = "C_TEST_COMMAND";
process.env.SLACK_TRUCK_4_CHANNEL_ID = "C_TEST_TRUCK_4";
process.env.SLACK_OPS_PAYMENT_CHANNEL_ID = "C_TEST_PAYMENT";
delete process.env.SLACK_OPS_CREW_CHANNEL_ID;

async function main() {
assert.equal(appointmentTerritory({ normalized_territory: "Jefferson Parish", market: "New Orleans" }), "Jefferson Parish");
assert.equal(appointmentTerritory({ territory: "Northshore" }), "Northshore");
assert.equal(appointmentTerritory({ market: "Baton Rouge" }), "Baton Rouge");
assert.equal(appointmentTerritory({}), "Unknown territory");

assert.equal(appointmentChannelId("New Orleans"), "C_TEST_NO");
assert.equal(appointmentChannelId("Jefferson Parish"), "C_TEST_NO");
assert.equal(appointmentChannelId("JP"), "C_TEST_NO");
assert.equal(appointmentChannelId("Baton Rouge"), "C_TEST_BR");
assert.equal(appointmentChannelId("North Shore"), "C_TEST_NS");
assert.equal(appointmentChannelId("Lafayette"), "C_TEST_DISPATCH");
assert.equal(appointmentChannelId("Unknown territory"), "C_TEST_DISPATCH");
assert.equal(normalizeSlackTruckNumber("Truck# 4"), 4);
assert.equal(normalizeSlackTruckNumber("Virtual Truck"), null);
assert.equal(truckSlackChannelId("Truck 4", "C_TEST_FALLBACK"), "C_TEST_TRUCK_4");
assert.equal(truckSlackChannelId("Unassigned", "C_TEST_FALLBACK"), "C_TEST_FALLBACK");
assert.equal(slackAlertKindEnabled("late_job"), false);
assert.equal(slackAlertKindEnabled("add_on"), true);
assert.equal(slackAlertKindEnabled("cancellation"), true);
assert.equal(slackAlertKindEnabled("unassigned_crew"), false);
assert.equal(slackAlertKindEnabled("truck_arrival"), true);
assert.equal(slackAlertKindEnabled("job_closed_payment"), true);

const paymentCloseoutAlerts = buildPaymentCloseoutSlackNotifications("2026-08-12", [
  {
    appt_id: "10",
    job_id: "JK4051000",
    final_status: "Completed",
    tip: "$50.80",
    closeout: {
      tip: "$50.80",
      payments: [{ method: "Credit Card", detail: "***3013", amount: "$558.80" }],
    },
  },
  {
    appt_id: "11",
    job_id: "JK4051001",
    job_status: "Completed Duration: 60 min(s)",
    closeout: {
      payments: [{ method: "Check", detail: "#1487", amount: "$198.00" }],
    },
  },
  {
    appt_id: "12",
    job_id: "JK4051002",
    job_status: "Completed",
    closeout: {
      payments: [{ method: "Cash", detail: "", amount: "$200.00" }],
    },
  },
  {
    appt_id: "13",
    job_id: "JK4051003",
    job_status: "Completed",
    closeout: {
      tip: "$15.00",
      payments: [
        { method: "Credit Card", detail: "xxxxxxxxxxxx4242", amount: "$100.00" },
        { method: "Cash", detail: "", amount: "$50.00" },
      ],
    },
  },
  {
    appt_id: "14",
    job_id: "JK4051004",
    job_status: "Confirmed",
    closeout: {
      payments: [{ method: "Credit Card", detail: "***9999", amount: "$99.00" }],
    },
  },
  {
    appt_id: "15",
    job_id: "JK4051005",
    job_status: "Completed",
    closeout: { payments: [] },
  },
]);

assert.deepEqual(
  paymentCloseoutAlerts.map((alert) => ({ channelId: alert.channelId, text: formatSlackAlert(alert) })),
  [
    {
      channelId: "C_TEST_PAYMENT",
      text: "JK4051000 closed out. Payment: Card ending 3013 ($558.80). Tip: $50.80.",
    },
    {
      channelId: "C_TEST_PAYMENT",
      text: "JK4051001 closed out. Payment: Check #1487 ($198.00).",
    },
    {
      channelId: "C_TEST_PAYMENT",
      text: "JK4051002 closed out. Payment: Cash ($200.00).",
    },
    {
      channelId: "C_TEST_PAYMENT",
      text: "JK4051003 closed out. Payments: Card ending 4242 ($100.00); Cash ($50.00). Tip: $15.00.",
    },
  ],
);

const truckArrivalAlerts = buildTruckArrivalSlackNotifications("2026-08-12", [
  {
    appointment_id: "4037246",
    jk_number: "JK4050424",
    truck_number: "Truck 4",
    visit_count: 2,
    match_confidence: "confirmed",
    visit_intervals: [
      { arrival: "2026-08-12T18:06:15Z", departure: "2026-08-12T18:24:00Z" },
      { arrival: "2026-08-12T18:41:09Z", departure: null },
    ],
  },
  {
    appointment_id: "4037246",
    jk_number: "JK4050424",
    truck_number: "Truck 4",
    visit_count: 2,
    match_confidence: "confirmed",
    visit_intervals: [
      { arrival: "2026-08-12T18:06:15Z", departure: "2026-08-12T18:24:00Z" },
      { arrival: "2026-08-12T18:41:09Z", departure: null },
    ],
  },
  {
    appointment_id: "4037205",
    jk_number: "JK4050383",
    truck_number: "Truck 6",
    visit_count: 1,
    match_confidence: "probable",
    first_arrival: "2026-08-12T18:10:00Z",
  },
]);

assert.equal(truckArrivalAlerts.length, 2);
assert.deepEqual(
  truckArrivalAlerts.map((alert) => ({ kind: alert.kind, channelId: alert.channelId, text: formatSlackAlert(alert) })),
  [
    { kind: "truck_arrival", channelId: "C_TEST_TRUCK_4", text: ":truck: Truck 4 arrived onsite at JK4050424." },
    { kind: "truck_arrival", channelId: "C_TEST_TRUCK_4", text: ":truck: Truck 4 arrived onsite at JK4050424." },
  ],
);

const temporaryDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-slack-alert-test-"));
process.env.OPSCENTER_DATA_DIR = temporaryDataDir;
const junkwareDirectory = path.join(temporaryDataDir, "history", "junkware");
fs.mkdirSync(junkwareDirectory, { recursive: true });
fs.writeFileSync(path.join(junkwareDirectory, "junkware_2026-08-12_raw.json"), JSON.stringify({
  scraped_at: "2026-08-12T13:15:00-05:00",
  cancelled: [
    {
      appt_id: "401",
      job_id: "JK4025001",
      normalized_territory: "Jefferson Parish",
      customer_name: "Test Customer",
      appointment_time: "1:00 PM - 3:00 PM",
      address: "123 Test Street",
      cancelled_by: "Dispatcher",
      cancellation_reason: "Customer requested",
      assigned_truck: "Truck 4",
    },
    {
      appt_id: "401",
      job_id: "JK4025001",
      territory: "New Orleans",
    },
  ],
}));

const cancellationFeed = buildCancelledAppointmentFeed("2026-08-12");
assert.equal(cancellationFeed.generatedAt, "2026-08-12T13:15:00-05:00");
assert.equal(cancellationFeed.appointments.length, 1);
assert.deepEqual(cancellationFeed.appointments[0], {
  id: "appt:401",
  appointmentId: "401",
  jobNumber: "JK4025001",
  territory: "Jefferson Parish",
  customerName: "Test Customer",
  address: "123 Test Street",
  appointmentTime: "1:00 PM - 3:00 PM",
  appointmentType: "Appointment",
  assignedTruck: "Truck 4",
  href: "/jobs?date=2026-08-12#job-jk4025001",
  cancelledBy: "Dispatcher",
  cancellationReason: "Customer requested",
});

const paymentStateFile = path.join(temporaryDataDir, "slack-state.json");
process.env.SLACK_OPSCENTER_STATE_FILE = paymentStateFile;
process.env.SLACK_OPSCENTER_ALERTS_ENABLED = "true";
process.env.SLACK_BOT_TOKEN = "xoxb-test-token";

const existingCloseout = {
  appt_id: "501",
  job_id: "JK4051501",
  final_status: "Completed",
  closeout: {
    payments: [{ method: "Cash", detail: "", amount: "$100.00" }],
  },
};
const newCloseout = {
  appt_id: "502",
  job_id: "JK4051502",
  final_status: "Completed",
  closeout: {
    tip: "$20.00",
    payments: [{ method: "Check", detail: "#2201", amount: "$220.00" }],
  },
};
fs.writeFileSync(path.join(junkwareDirectory, "junkware_2026-08-12_raw.json"), JSON.stringify({
  scraped_at: "2026-08-12T14:00:00-05:00",
  completed: [existingCloseout],
}));

const originalFetch = globalThis.fetch;
const postedMessages: string[] = [];
globalThis.fetch = (async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}"));
  postedMessages.push(String(body.text || ""));
  return new Response(JSON.stringify({ ok: true, channel: body.channel, ts: `1000.${postedMessages.length}` }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

try {
  const baselineRun = await runSlackOpsAlerts({ date: "2026-08-12" });
  assert.equal(baselineRun.bootstrappedPayments, 1);
  assert.equal(baselineRun.posted.length, 0);
  assert.equal(postedMessages.length, 0);

  fs.writeFileSync(path.join(junkwareDirectory, "junkware_2026-08-12_raw.json"), JSON.stringify({
    scraped_at: "2026-08-12T14:05:00-05:00",
    completed: [existingCloseout, newCloseout],
  }));
  const deliveryRun = await runSlackOpsAlerts({ date: "2026-08-12" });
  assert.deepEqual(deliveryRun.posted.map((alert) => alert.kind), ["job_closed_payment"]);
  assert.deepEqual(postedMessages, [
    "JK4051502 closed out. Payment: Check #2201 ($220.00). Tip: $20.00.",
  ]);

  const dedupeRun = await runSlackOpsAlerts({ date: "2026-08-12" });
  assert.equal(dedupeRun.posted.length, 0);
  assert.equal(postedMessages.length, 1);
} finally {
  globalThis.fetch = originalFetch;
  delete process.env.SLACK_OPSCENTER_STATE_FILE;
  delete process.env.SLACK_OPSCENTER_ALERTS_ENABLED;
  delete process.env.SLACK_BOT_TOKEN;
}

fs.rmSync(temporaryDataDir, { recursive: true });

const crewAlerts = buildCrewSlackNotifications("2026-08-12", [
  {
    name: "Clocked In Employee",
    clock_in: "07:03 AM",
    clock_out: null,
    hours_worked: 6.06,
    hourly_pay: 97.04,
    tip: 28.49,
    total_bonus: 0,
    total_pay: 125.53,
    pay_is_final: false,
  },
  {
    name: "Clocked Out Employee",
    clock_in: "07:15 AM",
    clock_out: "12:48 PM",
    hours_worked: 5.55,
    hourly_pay: 102.67,
    tip: 20.71,
    total_bonus: 15,
    total_pay: 138.38,
    pay_is_final: true,
  },
]);

assert.deepEqual(
  crewAlerts.map((alert) => ({ kind: alert.kind, channelId: alert.channelId, text: formatSlackAlert(alert) })),
  [
    { kind: "crew_clock_in", channelId: "C_TEST_COMMAND", text: "Clocked In Employee clocked in." },
    { kind: "crew_clock_in", channelId: "C_TEST_COMMAND", text: "Clocked Out Employee clocked in." },
    { kind: "crew_clock_out", channelId: "C_TEST_COMMAND", text: "Clocked Out Employee clocked out. Hours worked: 5.55." },
    {
      kind: "crew_daily_pay",
      channelId: "C_TEST_COMMAND",
      text: "Clocked Out Employee total pay: $138.38. Hourly pay: $102.67. Tips: $20.71. Bonuses: $15.00.",
    },
  ],
);

const duplicateRows = buildCrewSlackNotifications("2026-08-12", [
  { name: "Employee, Example", clock_in: "8:00 AM" },
  { name: "Example Employee", clock_in: "8:00 AM" },
]);
assert.equal(duplicateRows.length, 1);

const nonfinalPay = buildCrewSlackNotifications("2026-08-12", [
  {
    name: "Nonfinal Employee",
    clock_in: "8:00 AM",
    clock_out: "4:00 PM",
    hours_worked: 8,
    hourly_pay: 128,
    tip: 10,
    total_bonus: 0,
    total_pay: 138,
    pay_is_final: false,
  },
]);
assert.deepEqual(nonfinalPay.map((alert) => alert.kind), ["crew_clock_in", "crew_clock_out"]);

const inconsistentPay = buildCrewSlackNotifications("2026-08-12", [
  {
    name: "Inconsistent Employee",
    clock_in: "8:00 AM",
    clock_out: "4:00 PM",
    hours_worked: 8,
    hourly_pay: 128,
    tip: 10,
    total_bonus: 5,
    total_pay: 999,
    pay_is_final: true,
  },
]);
assert.deepEqual(inconsistentPay.map((alert) => alert.kind), ["crew_clock_in", "crew_clock_out"]);

console.log("Slack appointment, truck arrival, payment closeout, and crew notification tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
