import assert from 'node:assert/strict';
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
console.log('Fleet inspection status: submitted, absent, HQ, outside HQ, started assignment and unavailable/stale evidence pass.');

assert.equal(status(false,true,{...source,lastGpsUpdate:'invalid'}),'Unknown');

assert.equal(fleetInspectionStatus(date,true,true,undefined,now),'Unknown');
