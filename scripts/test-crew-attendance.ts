import assert from "node:assert/strict";
import { crewClockRowForEmployee, workedOrAttributedToJobToday } from "@/lib/crew-attendance";

assert.equal(workedOrAttributedToJobToday({ roster_only: true, hours_worked: 0 }), false);
assert.equal(workedOrAttributedToJobToday({ hours_basis: "inferred", revenue_generated: 900 }), false);
assert.equal(workedOrAttributedToJobToday({ clock_in: "07:15 AM", hours_worked: 0 }), true);
assert.equal(workedOrAttributedToJobToday({ clock_in: null }, { timeIn: "07:15 AM" }), true);
assert.equal(workedOrAttributedToJobToday({ hourly_pay: 0, attended_appointment_ids: ["appt:123"] }), true);
assert.equal(workedOrAttributedToJobToday({ hourly_pay: 0, completed_jobs: 1 }), true);
assert.equal(
  workedOrAttributedToJobToday(
    { name: "Jonathan Myles", roster_only: true },
    crewClockRowForEmployee("Jonathan Myles", [{ name: "Myles, Jonathan", timeIn: "07:15 AM" }]),
  ),
  true,
);

console.log("Crew attendance filter checks passed.");
