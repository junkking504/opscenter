import assert from "node:assert/strict";
import { detectScheduleChanges } from "@/lib/junkware-schedule-changes";
import { formatSlackAlert } from "@/lib/slack-alerts";

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
    {
      appt_id: "1",
      job_id: "JK4051001",
      job_status: "Completed",
      appointment_time: "9:00 AM",
      truck: "Truck 6",
      market: "Baton Rouge",
      customer_name: "Test Customer",
      driver_normalized_name: "Test Driver",
      navigator_normalized_name: "Test Navigator",
      revenue: "$500.00",
      closeout: {
        loadSize: "1 (1/4)",
        loadPrice: "$500.00",
        tip: "",
        total: "$500.00",
        payments: [{ method: "Credit Card", detail: "***1234", amount: "$500.00" }],
      },
    },
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

const events = detectScheduleChanges(previous, current);
assert.deepEqual(events.map((event) => event.kind).sort(), ["cancelled", "estimate_closed", "job_closed", "new_appointment", "rescheduled"]);
assert.equal(events.find((event) => event.kind === "job_closed")?.alert.channelId, "C_TEST_TRUCK_6");
assert.equal(formatSlackAlert(events.find((event) => event.kind === "job_closed")!.alert), [
  ":moneybag: *Job Closed*",
  "*<https://ops.junk-king.app/jobs?date=2026-08-17#job-jk4051001|JK4051001>*",
  "*Test Customer*",
  "*Driver:* Test Driver",
  "*Navigator:* Test Navigator",
  "*Load:* $500.00 (1/4)",
  "*Tips:*",
  "*Total:* $500.00",
  "*Card Ending:* 1234",
].join("\n"));
assert.equal(events.find((event) => event.kind === "estimate_closed")?.alert.channelId, "C_TEST_TRUCK_6");
assert.equal(formatSlackAlert(events.find((event) => event.kind === "estimate_closed")!.alert), [
  ":moneybag: *Estimate Closed*",
  "*<https://ops.junk-king.app/jobs?date=2026-08-17#job-jk4051006|JK4051006>*",
  "*Estimate Customer*",
  "*Driver:* Estimate Driver",
  "*Navigator:* Estimate Navigator",
  "*Load:* $180.00 (1/4)",
  "*Tips:*",
  "*Total:* $180.00",
].join("\n"));
assert.equal(formatSlackAlert(events.find((event) => event.kind === "rescheduled")!.alert), [
  ":warning: *Rescheduled*",
  "*<https://ops.junk-king.app/jobs?date=2026-08-17#job-jk4051002|JK4051002>*",
  "Previous: 10:00 AM",
  "New: 11:00 AM",
].join("\n"));
assert.equal(events.filter((event) => event.fingerprint.includes("appt-5")).length, 0);
assert.deepEqual(detectScheduleChanges(null, current), []);
console.log("JunkWare schedule change detector tests passed.");
