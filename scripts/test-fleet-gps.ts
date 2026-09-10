import assert from "node:assert/strict";

import {
  applyAppointmentVisitConfirmations,
  type AppointmentVisitConfirmation,
} from "@/lib/appointment-visit-confirmations";
import { classifyOperationalStatus, operationalStatusForFreshness } from "@/lib/fleet-map";

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

assert.equal(
  classifyOperationalStatus({
    latest: { latitude: 30.453291, longitude: -90.052799, speed: 0, ignition: "ON" },
    routePoints: [],
    routeStops: [{
      kind: "At Job",
      label: "JK4068519",
      truck: "Truck# 8",
      latitude: 30.453521,
      longitude: -90.05266,
      begin: "2026-08-28T15:25:19Z",
      end: "2026-08-28T17:14:18Z",
      source: "appointment_visit",
    }],
  }),
  "Idle",
  "A historical job visit cannot prove a truck is currently on site.",
);

console.log("Fleet GPS status and appointment confirmation tests passed.");

import { truckGpsStatus, PARKED_GPS_MAX_AGE_MS } from '../lib/truck-gps-status';
const now = Date.parse('2026-09-10T17:00:00Z');
const observation = (minutes: number, speed: number | null = 0, ignition = 'OFF') => ({lastGpsUpdate: new Date(now - minutes * 60_000).toISOString(), speed, ignition});
assert.equal(truckGpsStatus(observation(58), now).freshness, 'Parked report');
assert.equal(truckGpsStatus(observation(58), now).status, 'Parked');
assert.equal(truckGpsStatus(observation(1, 40, 'ON'), now).status, 'Driving');
assert.equal(truckGpsStatus(observation(1, 40, 'OFF'), now).status, 'Driving', 'Motion must win over conflicting ignition.');
assert.equal(truckGpsStatus(observation(1, 0, 'ON'), now).status, 'Idle');
assert.equal(truckGpsStatus(observation(1, 0, ''), now).status, 'Stopped');
assert.equal(truckGpsStatus(observation(1, null), now).status, 'Motion unavailable');
assert.equal(truckGpsStatus(observation(58, 19, 'ON'), now).stale, true);
assert.equal(truckGpsStatus(observation(58, 19, 'OFF'), now).stale, true);
assert.equal(truckGpsStatus(observation(58, null), now).stale, true);
assert.equal(truckGpsStatus(observation(PARKED_GPS_MAX_AGE_MS / 60_000 + 1), now).stale, true);
assert.equal(truckGpsStatus(observation(121), now).freshness, 'Offline');
assert.equal(truckGpsStatus(observation(-1), now).status, 'GPS unavailable');
assert.equal(truckGpsStatus(undefined, now).status, 'GPS unavailable');
assert.equal(operationalStatusForFreshness('Unknown', 'GPS unavailable'), 'GPS unavailable');
const yard = {latitude:29.986518, longitude:-90.058529};
assert.equal(classifyOperationalStatus({latest:{...yard,speed:0,ignition:'OFF'},routePoints:[],routeStops:[]}), 'Parked · NOHQ');
assert.equal(classifyOperationalStatus({latest:{...yard,speed:20,ignition:'ON'},routePoints:[],routeStops:[{...yard,kind:'At Yard',label:'NOHQ',truck:'Truck 2',begin:'',end:'',source:'linxup_stop'}]}), 'Driving', 'A previous yard stop cannot override current motion.');
assert.equal(classifyOperationalStatus({latest:{latitude:30.4,longitude:-90.04,speed:null},routePoints:[],routeStops:[]}), 'Unknown');
import { freshTruckGps } from '../lib/schedule-next-stop';
assert.equal(freshTruckGps({...observation(58),latitude:30,longitude:-90},now),false,'A parked report must not gain live ETA eligibility.');
console.log('Parked heartbeat, motion, expired reports and unavailable GPS tests passed.');

import { displayedGpsFreshness } from '../desktop-ui/lib/people-fleet-contract';
assert.equal(displayedGpsFreshness(observation(58).lastGpsUpdate,'2026-09-10',now,observation(58)),'Parked report');
assert.equal(displayedGpsFreshness(observation(76).lastGpsUpdate,'2026-09-10',now,observation(76)),'GPS Stale');
assert.equal(displayedGpsFreshness(observation(58).lastGpsUpdate,'2026-09-09',now,observation(58)),'Historical GPS');

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFleetMapPayload } from '../lib/fleet-map';
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(),'fleet-gps-inventory-'));
const originalDirectory = process.cwd();
try {
  fs.mkdirSync(path.join(fixtureRoot,'data/config'),{recursive:true});
  fs.mkdirSync(path.join(fixtureRoot,'data/history/linxup'),{recursive:true});
  fs.writeFileSync(path.join(fixtureRoot,'data/config/linxup_vehicle_map.json'),JSON.stringify({mappings:[11,12].map(n=>({junkware_truck_number:`Truck ${n}`,status:'active'}))}));
  fs.writeFileSync(path.join(fixtureRoot,'data/history/linxup/linxup_location_2001-01-01.json'),JSON.stringify({points:[{truck_number:'Truck 11',timestamp:'2001-01-01T17:00:00Z',latitude:30,longitude:-90,speed:0,ignition_state:'OFF'}]}));
  process.chdir(fixtureRoot);
  const fleet = buildFleetMapPayload('2001-01-01');
  assert.equal(fleet?.trucks.length,2,'GPS inventory survives missing metrics and includes mapped silent trucks.');
  assert.equal(fleet?.trucks.find(t=>t.truck==='Truck# 11')?.hasCoordinates,true);
  assert.equal(fleet?.trucks.find(t=>t.truck==='Truck# 12')?.hasCoordinates,false);
} finally {
  process.chdir(originalDirectory);
  fs.rmSync(fixtureRoot,{recursive:true,force:true});
}
