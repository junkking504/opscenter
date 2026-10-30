import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readDesktopFleet } from '../lib/desktop-fleet';
import { INSPECTION_SECTIONS, type TruckInspectionReport } from '../lib/truck-inspection';
import { fleetInspectionStatus } from '../lib/fleet-inspection-status';
import type { FleetTruckMapRecord } from '../lib/fleet-map';
const date='2026-10-29', now=Date.parse('2026-10-29T16:00:00Z');
const hq={timestamp:'2026-10-29T15:59:00Z',latitude:29.9863006,longitude:-90.0586452};
const away={...hq,latitude:30.01};
const source={hasCoordinates:true,lastGpsUpdate:hq.timestamp,speed:0,ignition:'OFF',routePoints:[hq],relatedAppointments:[]} as unknown as FleetTruckMapRecord;
const status=(submitted:boolean,available=true,gps:FleetTruckMapRecord|undefined=source)=>fleetInspectionStatus(date,submitted,available,gps,now);
assert.equal(status(true),'Submitted');
assert.equal(status(false),'Missing');
assert.equal(status(false,true,{...source,routePoints:[hq,away] as FleetTruckMapRecord['routePoints']}),'In Use, No Inspection');
assert.equal(status(true,true,{...source,routePoints:[away] as FleetTruckMapRecord['routePoints']}),'Submitted');
assert.equal(status(false,true,{...source,relatedAppointments:[{status:'In Progress'}] as FleetTruckMapRecord['relatedAppointments']}),'In Use, No Inspection');
assert.equal(fleetInspectionStatus(date,false,true,undefined,now),'Unknown');
assert.equal(status(false,false),'Unknown');
assert.equal(status(true,false),'Unknown');
assert.equal(status(false,true,{...source,lastGpsUpdate:'2026-10-29T12:00:00Z'}),'Unknown');
assert.equal(status(false,true,{...source,lastGpsUpdate:'2026-10-28T15:59:00Z'}),'Unknown');
assert.equal(status(false,true,{...source,routePoints:[{...away,timestamp:'2026-10-28T15:59:00Z'}] as FleetTruckMapRecord['routePoints']}),'Missing');
assert.equal(status(false,true,{...source,relatedAppointments:[{status:'Scheduled'}] as FleetTruckMapRecord['relatedAppointments']}),'Missing');

assert.equal(status(false,true,{...source,lastGpsUpdate:'invalid'}),'Unknown');

assert.equal(fleetInspectionStatus(date,true,true,undefined,now),'Submitted');

for (const gps of [
  {...source, hasCoordinates:false},
  {...source, lastGpsUpdate:'2026-10-29T12:00:00Z'},
  {...source, lastGpsUpdate:'2026-10-28T15:59:00Z'},
  {...source, lastGpsUpdate:'invalid'},
]) {
  assert.equal(status(true,true,gps),'Submitted','submitted report is independent of GPS availability');
  assert.equal(status(false,true,gps),'Unknown','missing report needs usable GPS before inferring use');
}

// Exercise the public snapshot projection with isolated stored evidence and no GPS.
const cwd = process.cwd();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-inspection-status-'));
const envKeys = ['HOME', 'OPSCENTER_DATA_DIR', 'OPSBOT_DATA_DIR', 'OPS_TRUCK_INSPECTION_DIR'] as const;
const previousEnv = envKeys.map(key => process.env[key]);
try {
  process.chdir(directory);
  process.env.HOME = directory;
  process.env.OPSCENTER_DATA_DIR = path.join(directory, 'data');
  process.env.OPSBOT_DATA_DIR = path.join(directory, 'data');
  process.env.OPS_TRUCK_INSPECTION_DIR = path.join(directory, 'data/fleet/truck-inspections');
  fs.mkdirSync(`data/fleet/truck-inspections/dates/${date}`, {recursive:true});
  const report: TruckInspectionReport = {
    version:2, deviceId:'test-device', requestId:'00000000-0000-4000-8000-000000000001',
    truck:'Truck# 4', inspector:'Test Inspector', odometer:'1000', fuel:'Full',
    startedAt:hq.timestamp, receivedAt:hq.timestamp, inspectionDate:date,
    answers:INSPECTION_SECTIONS.map(section => ({id:section.id,status:'good',notes:''})),
    photos:[], status:'clear', notes:'', initials:'TI',
  };
  fs.writeFileSync(`data/fleet/truck-inspections/dates/${date}/${'a'.repeat(64)}.json`,JSON.stringify(report));
  const repairFile = 'data/fleet/repair_issues.json';
  const writeRepairs = (issues:unknown[]) => fs.writeFileSync(repairFile,JSON.stringify({issues}));
  const truck = () => {
    const result = readDesktopFleet(date,'overview','admin').trucks.find(row => row.id === report.truck);
    assert.ok(result);
    assert.equal(result.gpsAt,null,'fixture has no GPS evidence');
    return result;
  };
  writeRepairs([]);
  assert.equal(truck().inspectionStatus,'Submitted');
  assert.equal(truck().readiness,'Ready','clear inspection remains ready without GPS');
  const repair = {issueId:'test-repair',truck:report.truck,title:'Test Repair',severity:'repair_soon',status:'open'};
  writeRepairs([repair]);
  assert.equal(truck().readiness,'Attention','open repairs remain visible without GPS');
  fs.unlinkSync(`data/fleet/truck-inspections/dates/${date}/${'a'.repeat(64)}.json`);
  assert.equal(truck().inspectionStatus,'Unknown');
  assert.equal(truck().readiness,'Attention','unknown inspection signal does not hide open repairs');
  writeRepairs([{...repair,severity:'out_of_service'}]);
  assert.equal(truck().readiness,'Out of service','GPS loss does not hide a stop condition');
  fs.unlinkSync(repairFile);
  assert.equal(truck().readiness,'Unavailable','missing repair source retains existing readiness behavior');
} finally {
  process.chdir(cwd);
  envKeys.forEach((key,index) => {
    if (previousEnv[index] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[index];
  });
  fs.rmSync(directory,{recursive:true,force:true});
}
console.log('Fleet inspection status and readDesktopFleet readiness regressions pass.');
