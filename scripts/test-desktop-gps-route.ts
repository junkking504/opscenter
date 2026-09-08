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
// Truck 9 regression: sparse primary reports and a stale poll at the same instant.
// Synthetic geometry and times; no operational telemetry is stored in this fixture.
const truck9=(timestamp:string,latitude:number,extra:Record<string,unknown>={})=>point(timestamp,latitude,-90,{truck_number:'Truck 9',delivery_source:'v3_position_push',...extra});
const sparsePoints=[truck9('2026-09-06T13:00:00Z',30),truck9('2026-09-06T13:06:00Z',30.03),truck9('2026-09-06T13:17:00Z',30.1),truck9('2026-09-06T13:43:00Z',30.2),truck9('2026-09-06T13:44:00Z',30.201)];
const sparse=normalizeTruckGpsRoute({points:sparsePoints},date,'Truck 9',now);
assert.equal(sparse.gaps,3);assert.deepEqual(sparse.paths.map(p=>p.length),[2]);
assert.equal(sparse.gapLinks?.length,3,'Six to twenty-six minute reports remain visible as explicitly uncertain links');
assert.deepEqual(sparse.gapLinks?.flat().map(p=>Object.keys(p)),Array(6).fill(['timestamp','latitude','longitude']),'Gap links expose only sanitized geometry');
assert.equal(jump.gapLinks?.length,0,'Impossible jumps must not become dashed links');
assert.equal(route.gapLinks?.length,0,'Long outages must stay disconnected');
const exactCutoffs=normalizeTruckGpsRoute({points:[truck9('2026-09-06T13:00:00Z',30),truck9('2026-09-06T13:05:00Z',30.01),truck9('2026-09-06T13:35:00Z',30.02),truck9('2026-09-06T14:05:01Z',30.03)]},date,'Truck 9',now);
assert.equal(exactCutoffs.paths.length,1);assert.equal(exactCutoffs.gapLinks?.length,1,'Five minutes is solid, thirty dashed, over thirty disconnected');
const fallback=truck9('2026-09-06T13:17:00Z',29,{delivery_source:'v2_poll',continuous_until:'2026-09-06T20:00:00Z'});
for(const points of [[fallback,...sparsePoints],[...sparsePoints,fallback]]) {
  const resolved=normalizeTruckGpsRoute({points},date,'Truck 9',now);
  assert.deepEqual(resolved,sparse,'Primary push wins regardless of input order and stale fallback coverage');
}
const fallbackOnly=normalizeTruckGpsRoute({points:[fallback]},date,'Truck 9',now);
assert.equal(fallbackOnly.points.length,1,'Keep poll history when there is no primary report for that instant');
const invalidPrimary=normalizeTruckGpsRoute({points:[fallback,truck9(fallback.timestamp,95)]},date,'Truck 9',now);
assert.equal(invalidPrimary.points[0].latitude,29,'Invalid primary geometry must not suppress usable fallback');
assert.equal(invalidPrimary.rejected,1);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ops-gps-route-test-'));
try {
  fs.mkdirSync(path.join(root,'history','linxup'),{recursive:true});
  fs.writeFileSync(path.join(root,'history','linxup',`linxup_location_${date}.json`),JSON.stringify(source));
  assert.equal(readTruckGpsRoute(date,truck,root,now).points.length,4,'GPS does not depend on a payroll/metrics file');
  assert.equal(readTruckGpsRoute('2026-09-05',truck,root,now).status,'unavailable');
  assert.throws(()=>readTruckGpsRoute('../bad',truck,root,now));
} finally {fs.rmSync(root,{recursive:true,force:true});}
console.log('GPS route contracts passed: Central date and truck isolation, no payroll dependency, source-only geometry, gaps, jumps, stationary compression, invalid records, and missing history.');
