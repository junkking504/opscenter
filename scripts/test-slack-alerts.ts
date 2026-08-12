import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appointmentTerritory, buildCancelledAppointmentFeed } from "@/lib/add-on-notifications";
import {
  appointmentChannelId,
  buildCrewSlackNotifications,
  buildTruckArrivalSlackNotifications,
  formatSlackAlert,
  slackAlertKindEnabled,
} from "@/lib/slack-alerts";

process.env.SLACK_JOBS_NO_CHANNEL_ID = "C_TEST_NO";
process.env.SLACK_JOBS_BR_CHANNEL_ID = "C_TEST_BR";
process.env.SLACK_JOBS_NS_CHANNEL_ID = "C_TEST_NS";
process.env.SLACK_OPS_DISPATCH_CHANNEL_ID = "C_TEST_DISPATCH";
process.env.SLACK_OPS_COMMAND_CHANNEL_ID = "C_TEST_COMMAND";
delete process.env.SLACK_OPS_CREW_CHANNEL_ID;

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
assert.equal(slackAlertKindEnabled("late_job"), false);
assert.equal(slackAlertKindEnabled("add_on"), true);
assert.equal(slackAlertKindEnabled("cancellation"), true);
assert.equal(slackAlertKindEnabled("unassigned_crew"), true);
assert.equal(slackAlertKindEnabled("truck_arrival"), true);

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
    { kind: "truck_arrival", channelId: "C_TEST_DISPATCH", text: ":truck: Truck 4 arrived onsite at JK4050424." },
    { kind: "truck_arrival", channelId: "C_TEST_DISPATCH", text: ":truck: Truck 4 arrived onsite at JK4050424." },
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
  assignedTruck: "Unassigned",
  href: "/jobs?date=2026-08-12#job-jk4025001",
  cancelledBy: "Dispatcher",
  cancellationReason: "Customer requested",
});

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

console.log("Slack appointment change, truck arrival, and crew notification tests passed.");
