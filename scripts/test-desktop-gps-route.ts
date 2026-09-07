import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gpsRouteDate,gpsRouteTruck,normalizeTruckGpsRoute,readTruckGpsRoute} from '../lib/desktop-gps-route';
const now=Date.parse('2026-09-07T22:00:00Z'),date='2026-09-06',truck='Truck 4';
const point=(timestamp:string,latitude=30,longitude=-90,extra:Record<string,unknown>={})=>({timestamp,latitude,longitude,truck_number:truck,tracker_id:'private-tracker',address:'private address',...extra});
const source={collection_timestamp:'2026-09-07T05:00:00Z',points:[
  point('2026-09-06T13:02:00Z',30.002),point('2026-09-06T13:00:00Z'),point('2026-09-06T13:01:00Z',30.001),point('2026-09-06T13:01:00Z',30.001),
  point('2026-09-06T04:59:00Z'), // Previous Central date.
  point('2026-09-07T04:59:00Z',30.1), // Still the selected Central date.
  point('2026-09-07T05:01:00Z'), // Next Central date.
  point('2026-09-06T14:00:00Z',30,-90,{truck_number:'Truck 6'}),
  point('2026-09-08T13:00:00Z'),point('bad timestamp'),point('2026-09-06T15:00:00Z',null as unknown as number),point('2026-09-06T15:00:00Z',95),
]};
const route=normalizeTruckGpsRoute(source,date,truck,now);
assert.equal(route.status,'available');assert.equal(route.points.length,4);
assert.deepEqual(route.paths.map(points=>points.length),[3]);assert.equal(route.gaps,1);
assert.equal(route.points[0].timestamp,'2026-09-06T13:00:00.000Z');
assert.equal(route.points.at(-1)?.timestamp,'2026-09-07T04:59:00.000Z');
assert.doesNotMatch(JSON.stringify(route),/private-tracker|private address|truck_number/,'Only the selected truck geometry and timestamps leave the route reader');
const jump=normalizeTruckGpsRoute({points:[point('2026-09-06T13:00:00Z'),point('2026-09-06T13:00:02Z',31),point('2026-09-06T13:00:03Z',31.0001)]},date,truck,now);
assert.equal(jump.gaps,1);assert.equal(jump.paths[0].length,2,'Impossible jumps must not draw a connector');
const compressed=normalizeTruckGpsRoute({points:[point('2026-09-06T13:00:00Z'),point('2026-09-06T13:00:00Z',30,-90,{continuous_until:'2026-09-06T15:00:00Z'}),point('2026-09-06T15:01:00Z',30.001)]},date,truck,now);
assert.equal(compressed.gaps,0,'Retain stationary observation coverage across duplicate source copies');
const parked=normalizeTruckGpsRoute({points:[point('2026-09-06T13:00:00Z',30,-90,{continuous_until:'2026-09-06T15:00:00Z'})]},date,truck,now);
assert.equal(parked.coveredThrough,'2026-09-06T15:00:00.000Z','Show recorded stationary coverage rather than the first stationary timestamp alone');
const compressedJump=normalizeTruckGpsRoute({points:[point('2026-09-06T13:00:00Z',30,-90,{continuous_until:'2026-09-06T15:00:00Z'}),point('2026-09-06T15:00:02Z',31)]},date,truck,now);
assert.equal(compressedJump.gaps,1,'Implied speed starts after the recorded stationary interval');
assert.equal(normalizeTruckGpsRoute({points:[]},date,truck,now).status,'empty');
assert.equal(normalizeTruckGpsRoute(null,date,truck,now).status,'unavailable');
assert.equal(normalizeTruckGpsRoute({points:[point('2026-09-06T13:00:00Z')]},'2026-09-07',truck,now).points.length,0,'A last-known yesterday position cannot become today travel');
assert.equal(gpsRouteDate('2026-02-30'),false);assert.equal(gpsRouteDate('../2026-09-06'),false);
assert.equal(gpsRouteTruck('truck# 4'),'Truck 4');assert.equal(gpsRouteTruck('Unassigned'),null);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ops-gps-route-test-'));
try {
  fs.mkdirSync(path.join(root,'history','linxup'),{recursive:true});
  fs.writeFileSync(path.join(root,'history','linxup',`linxup_location_${date}.json`),JSON.stringify(source));
  assert.equal(readTruckGpsRoute(date,truck,root,now).points.length,4,'GPS does not depend on a payroll/metrics file');
  assert.equal(readTruckGpsRoute('2026-09-05',truck,root,now).status,'unavailable');
  assert.throws(()=>readTruckGpsRoute('../bad',truck,root,now));
} finally {fs.rmSync(root,{recursive:true,force:true});}
console.log('GPS route contracts passed: Central date and truck isolation, no payroll dependency, source-only geometry, gaps, jumps, stationary compression, invalid records, and missing history.');
