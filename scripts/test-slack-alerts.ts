import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appointmentItemDescriptions,
  appointmentTerritory,
  buildCancelledAppointmentFeed,
} from "@/lib/add-on-notifications";
import { appointmentTerritoryForLocation } from "@/lib/appointment-territory";
import {
  appointmentChannelId,
  buildAddOnSlackNotification,
  buildCancellationSlackNotification,
  buildCrewSlackNotifications,
  buildTruckArrivalSlackNotifications,
  buildTruckCloseoutSlackNotifications,
  buildTruckEstimateCloseoutSlackNotifications,
  formatSlackAlert,
  publishVerifiedTruckCloseout,
  recordDeliveredTruckCloseout,
  runSlackOpsAlerts,
  slackAlertKindEnabled,
} from "@/lib/slack-alerts";
import { publishScheduleChanges } from "@/lib/junkware-schedule-changes";
import { normalizeSlackTruckNumber, truckSlackChannelId } from "@/lib/slack-truck-channels";

process.env.SLACK_JOBS_NO_CHANNEL_ID = "C_TEST_NO";
process.env.SLACK_JOBS_BR_CHANNEL_ID = "C_TEST_BR";
process.env.SLACK_JOBS_NS_CHANNEL_ID = "C_TEST_NS";
process.env.SLACK_OPS_DISPATCH_CHANNEL_ID = "C_TEST_DISPATCH";
process.env.SLACK_OPS_COMMAND_CHANNEL_ID = "C_TEST_COMMAND";
process.env.SLACK_TRUCK_1_CHANNEL_ID = "C_TEST_TRUCK_1";
process.env.SLACK_TRUCK_4_CHANNEL_ID = "C_TEST_TRUCK_4";
process.env.SLACK_TRUCK_6_CHANNEL_ID = "C_TEST_TRUCK_6";
process.env.SLACK_OPS_PAYMENT_CHANNEL_ID = "C_TEST_PAYMENT";
delete process.env.SLACK_OPS_CREW_CHANNEL_ID;

async function main() {
assert.equal(appointmentTerritory({ normalized_territory: "Jefferson Parish", market: "New Orleans" }), "Jefferson Parish");
assert.equal(appointmentTerritory({ territory: "Northshore" }), "Northshore");
assert.equal(appointmentTerritory({ market: "Baton Rouge" }), "Baton Rouge");
assert.equal(
  appointmentTerritory({
    normalized_territory: "Northshore",
    service_address: "8416 Quiet Creek Dr, Denham Springs, LA 70726",
  }),
  "Baton Rouge",
);
assert.equal(appointmentTerritory({}), "Unknown territory");
assert.equal(
  appointmentTerritoryForLocation("Northshore", "Denham Springs", "LA 70726"),
  "Baton Rouge",
);
assert.equal(
  appointmentTerritoryForLocation("Northshore", "Hammond, LA 70403"),
  "Northshore",
);

assert.equal(appointmentChannelId("New Orleans"), "C_TEST_NO");
assert.equal(appointmentChannelId("Jefferson Parish"), "C_TEST_NO");
assert.equal(appointmentChannelId("JP"), "C_TEST_NO");
assert.equal(appointmentChannelId("Baton Rouge"), "C_TEST_BR");
assert.equal(
  appointmentChannelId(appointmentTerritory({
    territory: "Northshore",
    city: "Denham Springs",
  })),
  "C_TEST_BR",
);
assert.equal(appointmentChannelId("North Shore"), "C_TEST_NS");
assert.equal(appointmentChannelId("Lafayette"), "C_TEST_DISPATCH");
assert.equal(appointmentChannelId("Unknown territory"), "C_TEST_DISPATCH");
assert.equal(
  buildAddOnSlackNotification({
    id: "appt:4039430",
    appointmentId: "4039430",
    jobNumber: "JK4052608",
    territory: "New Orleans",
    customerName: "Test Customer",
    phone: "<tel:(504)555-0100|(504) 555-0100>",
    address: "4034 Tchoupitoulas St, New Orleans, 70115",
    appointmentTime: "12:00 PM - 01:00 PM",
    appointmentType: "Job",
    assignedTruck: "Truck# 1",
    items: [],
    href: "/jobs?date=2026-08-14#job-jk4052608",
  }, "2026-08-14").channelId,
  "C_TEST_NO",
);
assert.equal(
  buildCancellationSlackNotification({
    id: "appt:4037405",
    appointmentId: "4037405",
    jobNumber: "JK4050583",
    territory: "Baton Rouge",
    customerName: "Test Customer",
    phone: "(225) 555-0100",
    address: "175 Burgin Ave, Baton Rouge, 70808",
    appointmentTime: "08:00 AM - 09:00 AM",
    appointmentType: "Job",
    assignedTruck: "Truck# 6",
    items: [],
    href: "/jobs?date=2026-08-14#job-jk4050583",
    cancelledBy: "Dispatcher",
    cancellationReason: "Customer cancelled",
  }, "2026-08-14").channelId,
  "C_TEST_BR",
);
const cancellationSlackAlert = buildCancellationSlackNotification({
  id: "appt:4037405",
  appointmentId: "4037405",
  jobNumber: "JK4050583",
  territory: "Baton Rouge",
  customerName: "Test Customer",
  phone: "(225) 555-0100",
  address: "175 Burgin Ave, Baton Rouge, 70808",
  appointmentTime: "08:00 AM - 09:00 AM",
  appointmentType: "Job",
  assignedTruck: "Truck# 6",
  items: [],
  href: "/jobs?date=2026-08-14#job-jk4050583",
  cancelledBy: "Dispatcher",
  cancellationReason: "Test Customer 2255550100 175 Burgin Ave Baton Rouge LA 70808 Customer cancelled",
}, "2026-08-14");
assert.equal(formatSlackAlert(cancellationSlackAlert), [
  ":x: *Cancellation*",
  "*<https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4050583|JK4050583>*",
  "08:00 AM - 09:00 AM",
  "Test Customer",
  "<tel:+12255550100|(225) 555-0100>",
  "175 Burgin Ave, Baton Rouge, 70808",
  "*Reason:* Customer cancelled",
].join("\n"));
const collapsedCancellationSlackAlert = buildCancellationSlackNotification({
  id: "appt:4045384",
  appointmentId: "4045384",
  jobNumber: "JK4058562",
  territory: "New Orleans",
  customerName: "Daniela Ortiz 8004215354x2071 400 Russell Ave New Orleans, LA 70143 Cancelled via email per accounts request Followup",
  phone: "",
  address: "",
  appointmentTime: "02:00 PM - 03:00 PM",
  appointmentType: "Job",
  assignedTruck: "",
  items: [],
  href: "/jobs?date=2026-08-25#job-jk4058562",
  cancelledBy: "Sasek, Anna",
  cancellationReason: "Daniela Ortiz 8004215354x2071 400 Russell Ave New Orleans, LA 70143 Cancelled via email per accounts request Followup",
}, "2026-08-25");
assert.equal(formatSlackAlert(collapsedCancellationSlackAlert), [
  ":x: *Cancellation*",
  "*<https://ops.junk-king.app/jobs?date=2026-08-25#job-jk4058562|JK4058562>*",
  "02:00 PM - 03:00 PM",
  "Daniela Ortiz",
  "<tel:+18004215354;ext=2071|(800) 421-5354 x2071>",
  "400 Russell Ave New Orleans, LA 70143",
  "*Reason:* Cancelled via email per accounts request Followup",
].join("\n"));
const repeatedAddressCancellationSlackAlert = buildCancellationSlackNotification({
  id: "appt:4049973",
  appointmentId: "4049973",
  jobNumber: "JK4063151",
  territory: "Northshore",
  customerName: "Destiny Sanders",
  phone: "(832) 506-4186",
  address: "21115 Gardenia St, Covington, 70435",
  appointmentTime: "02:00 PM - 03:00 PM",
  appointmentType: "Job",
  assignedTruck: "",
  items: [],
  href: "/jobs?date=2026-08-25#job-jk4063151",
  cancelledBy: "Henriquez, Luis",
  cancellationReason: "Destiny Sanders 8325064186 21115 Gardenia St Covington, LA 70435 Husband came on the line and decided to cancel Followup",
}, "2026-08-25");
assert.equal(formatSlackAlert(repeatedAddressCancellationSlackAlert), [
  ":x: *Cancellation*",
  "*<https://ops.junk-king.app/jobs?date=2026-08-25#job-jk4063151|JK4063151>*",
  "02:00 PM - 03:00 PM",
  "Destiny Sanders",
  "<tel:+18325064186|(832) 506-4186>",
  "21115 Gardenia St, Covington, 70435",
  "*Reason:* Husband came on the line and decided to cancel Followup",
].join("\n"));
assert.equal(normalizeSlackTruckNumber("Truck# 4"), 4);
assert.equal(normalizeSlackTruckNumber("Virtual Truck"), null);
assert.equal(truckSlackChannelId("Truck 4", "C_TEST_FALLBACK"), "C_TEST_TRUCK_4");
assert.equal(truckSlackChannelId("Unassigned", "C_TEST_FALLBACK"), "C_TEST_FALLBACK");
assert.equal(slackAlertKindEnabled("late_job"), false);
assert.equal(slackAlertKindEnabled("add_on"), true);
assert.equal(slackAlertKindEnabled("cancellation"), true);
assert.equal(slackAlertKindEnabled("unassigned_crew"), false);
assert.equal(slackAlertKindEnabled("truck_arrival"), true);
assert.equal(slackAlertKindEnabled("job_closed"), true);

assert.deepEqual(appointmentItemDescriptions({
  appointment_notes: [
    "Additional Lead Note Label: What will be picking up?: Miscellaneous toys and household items, Business Name: Example, Service Type: Full Service",
  ],
}), ["Miscellaneous toys and household items"]);

const addOnSlackAlert = buildAddOnSlackNotification({
  id: "appt:400",
  appointmentId: "400",
  jobNumber: "JK4025000",
  territory: "New Orleans",
  customerName: "Test Customer",
  phone: "(504) 555-0100",
  address: "123 Test Street",
  appointmentTime: "1:00 PM - 3:00 PM",
  appointmentType: "Appointment",
  assignedTruck: "Truck# 4",
  items: ["Sofa", "Desk"],
  href: "/jobs?date=2026-08-12#job-jk4025000",
}, "2026-08-12");
assert.equal(addOnSlackAlert.channelId, "C_TEST_NO");
assert.equal(formatSlackAlert(addOnSlackAlert), [
  "*[Add-On]*",
  "JK4025000",
  "```",
  "Customer:  Test Customer",
  "Address:   123 Test Street",
  "```",
  "<https://ops.junk-king.app/jobs?date=2026-08-12#job-jk4025000|Open in OpsCenter>",
].join("\n"));
assert.doesNotMatch(formatSlackAlert(addOnSlackAlert), /Truck# 4|Alert ID|\*Next:\*/);

const completedCloseoutRows = [
  {
    appt_id: "10",
    job_id: "JK4051000",
    final_status: "Completed",
    truck: "Truck# 1",
    customer_name: "Closeout Customer",
    driver_normalized_name: "Driver One",
    navigator_normalized_name: "Navigator One",
    revenue: "$508.00",
    tip: "$50.80",
    closeout: {
      loadSize: "4 (1/2)",
      loadPrice: "$538.00",
      otherCharges: [
        { name: "Labor", amount: "$225.00" },
        { name: "CC Surcharge (Card Present)", amount: "$24.69" },
      ],
      discount: "$30.00",
      tip: "$50.80",
      total: "$558.80",
      payments: [{ method: "Credit Card", detail: "***3013", amount: "$558.80" }],
    },
  },
  {
    appt_id: "11",
    job_id: "JK4051001",
    job_status: "Completed Duration: 60 min(s)",
    assigned_truck: "Truck 6",
    customer_name: "Check Customer",
    driver_normalized_name: "Driver Six",
    navigator_normalized_name: "Navigator Six",
    closeout: {
      payments: [{ method: "Check", detail: "#1487", amount: "$198.00" }],
    },
  },
  {
    appt_id: "12",
    job_id: "JK4051002",
    job_status: "Completed",
    truck: "Virtual Truck",
    closeout: {
      payments: [{ method: "Cash", detail: "", amount: "$200.00" }],
    },
  },
  {
    appt_id: "13",
    job_id: "JK4051003",
    job_status: "Completed",
    truck: "Truck 1",
    customer_name: "Payment Customer",
    driver_normalized_name: "Driver Payment",
    navigator_normalized_name: "Navigator Payment",
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
    truck: "Truck 1",
    closeout: {
      payments: [{ method: "Credit Card", detail: "***9999", amount: "$99.00" }],
    },
  },
  {
    appt_id: "15",
    job_id: "JK4051005",
    job_status: "Completed",
    truck: "Truck 4",
    customer_name: "No Payment Customer",
    driver_normalized_name: "Driver Four",
    navigator_normalized_name: "Navigator Four",
    closeout: { payments: [] },
  },
];

assert.deepEqual(
  buildTruckCloseoutSlackNotifications("2026-08-12", completedCloseoutRows)
    .map((alert) => ({ kind: alert.kind, channelId: alert.channelId, text: formatSlackAlert(alert) })),
  [
    {
      kind: "job_closed",
      channelId: "C_TEST_TRUCK_1",
      text: [
        "*[Job Closed]*",
        "JK4051000",
        "```",
        "Load:       1/2 ($538.00)",
        "Discount:   $30.00",
        "Job total:  $508.00",
        "Tip:        $50.80",
        "Charged:    Card ending 3013 ($558.80)",
        "```",
        "<https://ops.junk-king.app/jobs?date=2026-08-12#job-jk4051000|Open in OpsCenter>",
      ].join("\n"),
    },
    {
      kind: "job_closed",
      channelId: "C_TEST_TRUCK_6",
      text: [
        "*[Job Closed]*",
        "JK4051001",
        "```",
        "Tip:      $0.00",
        "Charged:  Check #1487 ($198.00)",
        "```",
        "<https://ops.junk-king.app/jobs?date=2026-08-12#job-jk4051001|Open in OpsCenter>",
      ].join("\n"),
    },
    {
      kind: "job_closed",
      channelId: "C_TEST_TRUCK_1",
      text: [
        "*[Job Closed]*",
        "JK4051003",
        "```",
        "Tip:      $15.00",
        "Charged:  Card ending 4242 ($100.00); Cash ($50.00)",
        "```",
        "<https://ops.junk-king.app/jobs?date=2026-08-12#job-jk4051003|Open in OpsCenter>",
      ].join("\n"),
    },
  ],
);

const completedEstimateRows = [{
  appt_id: "16",
  job_id: "JK4051006",
  appointment_type: "Estimate",
  final_status: "Completed",
  truck: "Truck# 6",
  customer_name: "Estimate Customer",
  driver_normalized_name: "Estimate Driver",
  navigator_normalized_name: "Estimate Navigator",
  revenue: "$358.00",
  closeout: {
    loadSize: "1.5 (1/4)",
    loadPrice: "$328.00",
    otherCharges: [{ name: "Mattress/Box Spring", total: "$60.00" }],
    discount: "$30.00",
    tip: "",
    total: "$358.00",
    payments: [],
  },
}];

assert.deepEqual(
  buildTruckEstimateCloseoutSlackNotifications("2026-08-12", completedEstimateRows)
    .map((alert) => ({ kind: alert.kind, channelId: alert.channelId, text: formatSlackAlert(alert) })),
  [{
    kind: "estimate_closed",
    channelId: "C_TEST_TRUCK_6",
    text: [
      ":moneybag: *Estimate Closed*",
      "*<https://ops.junk-king.app/jobs?date=2026-08-12#job-jk4051006|JK4051006>*",
      "*Estimate Customer*",
      "*Driver:* Estimate Driver",
      "*Navigator:* Estimate Navigator",
      "*Load:* $328.00 (1/4)",
      "*Mattress/Box Spring:* $60.00",
      "*Discount:* $30.00",
      "*Tips:*",
      "*Total:* $358.00",
    ].join("\n"),
  }],
);
assert.equal(buildTruckCloseoutSlackNotifications("2026-08-12", completedEstimateRows).length, 0);

const truckArrivalAlerts = buildTruckArrivalSlackNotifications("2026-08-12", [
  {
    appointment_id: "4037246",
    jk_number: "JK4050424",
    customer_name: "Test Customer",
    phone: "(504) 555-0100",
    address: "123 Test Street, New Orleans, LA 70115",
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
    customer_name: "Test Customer",
    phone: "(504) 555-0100",
    address: "123 Test Street, New Orleans, LA 70115",
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
assert.doesNotMatch(formatSlackAlert(truckArrivalAlerts[0]), /Truck 4/);
assert.deepEqual(
  truckArrivalAlerts.map((alert) => ({ kind: alert.kind, channelId: alert.channelId, text: formatSlackAlert(alert) })),
  [
    {
      kind: "truck_arrival",
      channelId: "C_TEST_TRUCK_4",
      text: [
        "*[Truck Arrival]*",
        "```",
        "Job:       JK4050424",
        "Customer:  Test Customer",
        "Address:   123 Test Street, New Orleans, LA 70115",
        "```",
        "<https://ops.junk-king.app/jobs?date=2026-08-12#job-jk4050424|Open in OpsCenter>",
      ].join("\n"),
    },
    {
      kind: "truck_arrival",
      channelId: "C_TEST_TRUCK_4",
      text: [
        "*[Truck Arrival]*",
        "```",
        "Job:       JK4050424",
        "Customer:  Test Customer",
        "Address:   123 Test Street, New Orleans, LA 70115",
        "```",
        "<https://ops.junk-king.app/jobs?date=2026-08-12#job-jk4050424|Open in OpsCenter>",
      ].join("\n"),
    },
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
  phone: "Phone unavailable",
  address: "123 Test Street",
  appointmentTime: "1:00 PM - 3:00 PM",
  appointmentType: "Appointment",
  assignedTruck: "Truck 4",
  items: [],
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
  truck: "Truck# 4",
  closeout: {
    payments: [{ method: "Cash", detail: "", amount: "$100.00" }],
  },
};
const newCloseout = {
  appt_id: "502",
  job_id: "JK4051502",
  final_status: "Completed",
  assigned_truck: "Truck# 6",
  customer_name: "New Closeout Customer",
  driver_normalized_name: "New Driver",
  navigator_normalized_name: "New Navigator",
  closeout: {
    tip: "$20.00",
    total: "$220.00",
    payments: [{ method: "Check", detail: "#2201", amount: "$220.00" }],
  },
};
const newEstimateCloseout = {
  appt_id: "504",
  job_id: "JK4051504",
  appointment_type: "Estimate",
  final_status: "Completed",
  truck: "Truck# 6",
  customer_name: "New Estimate Customer",
  driver_normalized_name: "Estimate Driver",
  navigator_normalized_name: "Estimate Navigator",
  closeout: {
    loadSize: "1 (1/4)",
    loadPrice: "$180.00",
    tip: "",
    total: "$180.00",
    payments: [],
  },
};
const directCloseoutSource = {
  appt_id: "503",
  job_id: "JK4051503",
  final_status: "Completed",
  truck: "Truck# 6",
  customer_name: "Direct Closeout Customer",
  driver_normalized_name: "Direct Driver",
  navigator_normalized_name: "Direct Navigator",
  closeout: {},
};
fs.writeFileSync(path.join(junkwareDirectory, "junkware_2026-08-12_raw.json"), JSON.stringify({
  scraped_at: "2026-08-12T14:00:00-05:00",
  appointments: [{
    appt_id: "503",
    job_id: "JK4051503",
    customer_name: "Arrival Customer",
    phone: "(504) 555-0123",
    address: "503 Arrival Street, New Orleans, LA 70115",
  }],
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
  const arrivalVisitsFile = path.join(
    temporaryDataDir,
    "history",
    "linxup",
    "appointment_visits",
    "linxup_appointment_visits_2026-08-12.json",
  );
  fs.mkdirSync(path.dirname(arrivalVisitsFile), { recursive: true });
  fs.writeFileSync(arrivalVisitsFile, JSON.stringify({ visits: [] }));

  const arrivalBaseline = await runSlackOpsAlerts({ date: "2026-08-12", onlyKinds: ["truck_arrival"] });
  assert.equal(arrivalBaseline.posted.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(paymentStateFile, "utf8")).initializedAt, "");

  fs.writeFileSync(arrivalVisitsFile, JSON.stringify({
    visits: [{
      appointment_id: "503",
      jk_number: "JK4051503",
      truck_number: "Truck 6",
      visit_count: 1,
      match_confidence: "confirmed",
      first_arrival: "2026-08-12T18:47:43Z",
    }],
  }));
  const arrivalRun = await runSlackOpsAlerts({ date: "2026-08-12", onlyKinds: ["truck_arrival"] });
  assert.deepEqual(arrivalRun.posted.map((alert) => alert.kind), ["truck_arrival"]);
  assert.deepEqual(postedMessages, [
    [
      "*[Truck Arrival]*",
      "```",
      "Job:       JK4051503",
      "Customer:  Arrival Customer",
      "Address:   503 Arrival Street, New Orleans, LA 70115",
      "```",
      "<https://ops.junk-king.app/jobs?date=2026-08-12#job-jk4051503|Open in OpsCenter>",
    ].join("\n"),
  ]);
  postedMessages.length = 0;

  const baselineRun = await runSlackOpsAlerts({ date: "2026-08-12" });
  assert.equal(baselineRun.bootstrappedTruckCloseouts, 1);
  assert.equal(baselineRun.posted.length, 0);
  assert.equal(postedMessages.length, 0);

  fs.writeFileSync(path.join(junkwareDirectory, "junkware_2026-08-12_raw.json"), JSON.stringify({
    scraped_at: "2026-08-12T14:05:00-05:00",
    appointments: [newEstimateCloseout],
    completed: [existingCloseout, newCloseout],
  }));
  const deliveryRun = await runSlackOpsAlerts({ date: "2026-08-12" });
  assert.deepEqual(deliveryRun.posted.map((alert) => alert.kind), ["job_closed"]);
  assert.deepEqual(postedMessages, [
    [
      "*[Job Closed]*",
      "JK4051502",
      "```",
      "Tip:      $20.00",
      "Charged:  Check #2201 ($220.00)",
      "```",
      "<https://ops.junk-king.app/jobs?date=2026-08-12#job-jk4051502|Open in OpsCenter>",
    ].join("\n"),
  ]);

  const dedupeRun = await runSlackOpsAlerts({ date: "2026-08-12" });
  assert.equal(dedupeRun.posted.length, 0);
  assert.equal(postedMessages.length, 1);

  const incompleteCloseout = await publishVerifiedTruckCloseout({
    appointmentId: "503",
    jobNumber: "JK4051503",
    truck: "Truck 6",
    date: "2026-08-12",
    closeout: { tip: "$10.00" },
  });
  assert.deepEqual(incompleteCloseout, {
    attempted: false,
    posted: false,
    duplicate: false,
    reason: "Verified closeout does not include full payment details.",
  });
  assert.equal(postedMessages.filter((message) => message.includes("JK4051503")).length, 0);

  const directCloseout = await publishVerifiedTruckCloseout({
    appointmentId: "503",
    jobNumber: "JK4051503",
    truck: "Truck 6",
    date: "2026-08-12",
    closeout: { tip: "$10.00", payments: [{ method: "Cash", amount: "$110.00" }] },
  });
  assert.deepEqual(directCloseout, { attempted: true, posted: true, duplicate: false });
  assert.equal(postedMessages.at(-1), [
    "*[Job Closed]*",
    "JK4051503",
    "```",
    "Tip:      $10.00",
    "Charged:  Cash ($110.00)",
    "```",
    "<https://ops.junk-king.app/jobs?date=2026-08-12#job-jk4051503|Open in OpsCenter>",
  ].join("\n"));

  const duplicateDirectCloseout = await publishVerifiedTruckCloseout({
    appointmentId: "503",
    jobNumber: "JK4051503",
    truck: "Truck 6",
    date: "2026-08-12",
    closeout: { tip: "$10.00", payments: [{ method: "Cash", amount: "$110.00" }] },
  });
  assert.deepEqual(duplicateDirectCloseout, { attempted: false, posted: false, duplicate: true });
  assert.equal(postedMessages.filter((message) => message.includes("JK4051503")).length, 1);
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
    {
      kind: "crew_clock_in",
      channelId: "C_TEST_COMMAND",
      text: "*[Clock In]*\nClocked In Employee\n```\nStatus:  Clocked in\n```\n<https://ops.junk-king.app/crew/Clocked%20In%20Employee?date=2026-08-12|Open in OpsCenter>",
    },
    {
      kind: "crew_clock_in",
      channelId: "C_TEST_COMMAND",
      text: "*[Clock In]*\nClocked Out Employee\n```\nStatus:  Clocked in\n```\n<https://ops.junk-king.app/crew/Clocked%20Out%20Employee?date=2026-08-12|Open in OpsCenter>",
    },
    {
      kind: "crew_clock_out",
      channelId: "C_TEST_COMMAND",
      text: [
        "*[Clock Out]*",
        "Clocked Out Employee",
        "```",
        "Hours:   5.55",
        "Hourly:  $102.67",
        "Tips:    $20.71",
        "Bonus:   $15.00",
        "Total:   $138.38",
        "```",
        "<https://ops.junk-king.app/crew/Clocked%20Out%20Employee?date=2026-08-12|Open in OpsCenter>",
      ].join("\n"),
    },
  ],
);

const separateClockOuts = buildCrewSlackNotifications("2026-08-12", [
  {
    name: "Ivory Grace",
    clock_in: "9:00 AM",
    clock_out: "2:16 PM",
    hours_worked: 5.27,
    hourly_pay: 84.27,
    tip: 0,
    total_bonus: 0,
    total_pay: 84.27,
    pay_is_final: true,
  },
  {
    name: "Steven Miles",
    clock_in: "9:00 AM",
    clock_out: "2:31 PM",
    hours_worked: 5.52,
    hourly_pay: 88.27,
    tip: 0,
    total_bonus: 0,
    total_pay: 88.27,
    pay_is_final: true,
  },
]).filter((alert) => alert.kind === "crew_clock_out");
assert.equal(separateClockOuts.length, 2);
assert.equal(formatSlackAlert(separateClockOuts[0]), [
  "*[Clock Out]*",
  "Ivory Grace",
  "```",
  "Hours:   5.27",
  "Hourly:  $84.27",
  "Tips:    $0.00",
  "Bonus:   $0.00",
  "Total:   $84.27",
  "```",
  "<https://ops.junk-king.app/crew/Ivory%20Grace?date=2026-08-12|Open in OpsCenter>",
].join("\n"));
assert.doesNotMatch(formatSlackAlert(separateClockOuts[0]), /Steven Miles/);
assert.match(formatSlackAlert(separateClockOuts[1]), /^\*\[Clock Out\]\*\nSteven Miles\n/);

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
assert.deepEqual(nonfinalPay.map((alert) => alert.kind), ["crew_clock_in"]);

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
assert.deepEqual(inconsistentPay.map((alert) => alert.kind), ["crew_clock_in"]);

console.log("Slack appointment, truck arrival, full closeout, and crew notification tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
