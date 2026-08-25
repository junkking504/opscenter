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
assert.equal(formatSlackAlert(events.find((event) => event.kind === "job_closed")!.alert), [
  ":white_check_mark: *Job Closed*",
  "*<https://ops.junk-king.app/jobs?date=2026-08-17#job-jk4051001|JK4051001>*",
  "*Tips:*",
].join("\n"));
assert.match(String(events.find((event) => event.kind === "rescheduled")?.alert.detail), /Previous: 10:00 AM/);
assert.deepEqual(detectScheduleChanges(null, current), []);
console.log("JunkWare schedule change detector tests passed.");
