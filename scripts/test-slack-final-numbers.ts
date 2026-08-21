import assert from "node:assert/strict";
import { evaluateFinalNumbers } from "@/lib/slack-final-numbers";
import { formatSlackAlert } from "@/lib/slack-alerts";

const date = "2026-08-20";
const now = new Date("2026-08-21T00:05:00.000Z");

function metrics() {
  return {
    date,
    generated_at: "2026-08-21T00:00:00.000Z",
    total_revenue: 1_200,
    total_tips: 75,
    total_payroll: 240,
    payroll_percentage_of_revenue: 20,
    jobs_by_truck: { "Truck# 3": 2 },
    attendance_input: { available: true, verified: true },
    inputs: {
      junkware_raw: "junkware_raw.json",
      junkware_completed_summary: "junkware_completed.csv",
      junkware_employee_summary: "junkware_employees.csv",
      missing: ["qbo_summary.csv"],
    },
    employee_leaderboard: [
      {
        name: "Alex Crew",
        clock_in: "8:00 AM",
        clock_out: "4:00 PM",
        shift_status: "Clocked Out",
        hours_worked: 8,
        is_clocked_in: false,
      },
      {
        name: "Sam Crew",
        clock_in: "8:15 AM",
        clock_out: "4:15 PM",
        shift_status: "Clocked Out",
        hours_worked: 8,
        is_clocked_in: false,
      },
    ],
    appointments: [
      { appointment_type: "Job", job_status: "Completed Duration: 60 min(s)" },
      { appointment_type: "Job", job_status: "Closed" },
      { appointment_type: "Estimate", job_status: "Cancelled" },
    ],
  };
}

const ready = evaluateFinalNumbers(metrics(), date, { now, maxAgeMinutes: 20, addOnCount: 1, cancelCount: 1 });
assert.equal(ready.ready, true);
assert.deepEqual(ready.reasons, []);
assert.equal(ready.summary?.crewCount, 2);
assert.equal(ready.summary?.appointmentCount, 3);
assert.equal(ready.summary?.completedJobCount, 2);
assert.equal(ready.summary?.estimateCount, 1);
assert.equal(ready.summary?.addOnCount, 1);
assert.equal(ready.summary?.cancelCount, 1);
assert.equal(ready.summary?.unclosedCount, 0);
assert.equal(ready.summary?.averageJob, 600);
assert.equal(ready.summary?.revenuePerCrewHour, 75);
assert.equal(ready.summary?.laborPercent, 20);

const openShift = metrics();
openShift.employee_leaderboard[1].clock_out = "";
openShift.employee_leaderboard[1].shift_status = "On Shift";
openShift.employee_leaderboard[1].is_clocked_in = true;
const openShiftResult = evaluateFinalNumbers(openShift, date, { now, cancelCount: 1 });
assert.equal(openShiftResult.ready, false);
assert.match(openShiftResult.reasons.join(" "), /1 crew shift is not clocked out/);

const openAppointment = metrics();
openAppointment.appointments[0].job_status = "In Progress";
const openAppointmentResult = evaluateFinalNumbers(openAppointment, date, { now, cancelCount: 1 });
assert.equal(openAppointmentResult.ready, false);
assert.match(openAppointmentResult.reasons.join(" "), /1 appointment is not closed out/);

const stale = metrics();
stale.generated_at = "2026-08-20T23:00:00.000Z";
const staleResult = evaluateFinalNumbers(stale, date, { now, maxAgeMinutes: 20, cancelCount: 1 });
assert.equal(staleResult.ready, false);
assert.match(staleResult.reasons.join(" "), /older than 20 minutes/);

const unverifiedAttendance = metrics();
unverifiedAttendance.attendance_input.verified = false;
const unverifiedResult = evaluateFinalNumbers(unverifiedAttendance, date, { now, cancelCount: 1 });
assert.equal(unverifiedResult.ready, false);
assert.match(unverifiedResult.reasons.join(" "), /not fully verified/);

const formatted = formatSlackAlert({
  fingerprint: "final_numbers:2026-08-20",
  kind: "final_numbers",
  lifecycle: "notification",
  severity: "warning",
  channelId: "C0BNMDJNYV9",
  title: "EOD Report",
  detail: "",
  nextAction: "",
  href: "https://ops.junk-king.app/jobs?date=2026-08-20",
  fields: [
    { label: "Jobs", value: 13 },
    { label: "Estimates", value: 2 },
    { label: "Add-Ons", value: 1 },
    { label: "Cancels", value: 1 },
    { label: "Unclosed", value: 0 },
    { label: "Revenue", value: "$5,024.49" },
    { label: "AJS", value: "$386.50" },
    { label: "RPH", value: "$86.02" },
    { label: "Labor", value: "21.7%" },
  ],
});
assert.equal(formatted, [
  "*EOD Report*",
  "```",
  "Jobs:       13",
  "Estimates:  2",
  "Add-Ons:    1",
  "Cancels:    1",
  "Unclosed:   0",
  "Revenue:    $5,024.49",
  "AJS:        $386.50",
  "RPH:        $86.02",
  "Labor:      21.7%",
  "```",
].join("\n"));

console.log("Slack final-numbers gate tests passed.");
