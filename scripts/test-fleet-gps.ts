import assert from "node:assert/strict";

import {
  applyAppointmentVisitConfirmations,
  type AppointmentVisitConfirmation,
} from "@/lib/appointment-visit-confirmations";
import { operationalStatusForFreshness } from "@/lib/fleet-map";

const confirmations: AppointmentVisitConfirmation[] = [
  {
    date: "2026-08-13",
    appointment_id: "jane-appt",
    jk_number: "JK-JANE",
    truck_number: "Truck 9",
    first_arrival: "2026-08-13T17:23:50Z",
    final_departure: null,
    gps_gap_start: "2026-08-13T17:24:42Z",
    gps_gap_end: "2026-08-13T17:56:37Z",
    gps_gap_minutes: 31.92,
    confirmed_at: "2026-08-13T19:30:00Z",
    confirmation_source: "test",
    note: "Confirmed during a GPS gap.",
  },
  {
    date: "2026-08-13",
    appointment_id: "douglas-appt",
    jk_number: "JK-DOUGLAS",
    truck_number: "Truck 9",
    first_arrival: null,
    final_departure: null,
    gps_gap_start: "2026-08-13T18:03:01Z",
    gps_gap_end: "2026-08-13T18:45:54Z",
    gps_gap_minutes: 42.88,
    confirmed_at: "2026-08-13T19:30:00Z",
    confirmation_source: "test",
    note: "Confirmed during a GPS gap.",
  },
];

const visits = applyAppointmentVisitConfirmations([
  {
    appointment_id: "jane-appt",
    jk_number: "JK-JANE",
    truck_number: "Truck 9",
    visit_count: 0,
    match_reason: "pass_by_without_qualifying_dwell",
  },
  {
    appointment_id: "douglas-appt",
    jk_number: "JK-DOUGLAS",
    truck_number: null,
    visit_count: 0,
    match_reason: "no_physical_truck_assignment",
  },
  {
    appointment_id: "untouched-appt",
    jk_number: "JK-UNTOUCHED",
    truck_number: "Truck 4",
    visit_count: 1,
  },
], confirmations);

assert.equal(visits.length, 3);
for (const appointmentId of ["jane-appt", "douglas-appt"]) {
  const visit = visits.find((row) => row.appointment_id === appointmentId);
  assert.equal(visit?.truck_number, "Truck 9");
  assert.equal(visit?.visit_count, 1);
  assert.equal(visit?.operational_confirmation, true);
  assert.equal(visit?.match_status, "operationally_confirmed");
  assert.equal(visit?.match_reason, "operational_confirmation_with_gps_gap");
  assert.equal(visit?.gps_coverage_quality, "incomplete");
  assert.equal(visit?.onsite_minutes, 0);
}
assert.equal(visits.find((row) => row.appointment_id === "untouched-appt")?.truck_number, "Truck 4");

assert.equal(operationalStatusForFreshness("Driving", "Live GPS"), "Driving");
assert.equal(operationalStatusForFreshness("Driving", "GPS Stale"), "GPS Stale");
assert.equal(operationalStatusForFreshness("Idle", "Offline"), "Offline");

console.log("Fleet GPS status and appointment confirmation tests passed.");
