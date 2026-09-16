import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {batchedRoutePositions,withLinxupRouteDetail} from '../lib/linxup-route-detail';
import {readTruckGpsRoute} from '../lib/desktop-gps-route';
import {continuousGpsDisplayPaths,gpsTripDisplay} from '../desktop-ui/lib/gps-trip-display';
import {buildStreetRoute,readStreetRoute} from '../lib/desktop-street-route';

async function main() {
  const date='2026-09-01',end=Date.parse(`${date}T14:00:00Z`),root=fs.mkdtempSync(path.join(os.tmpdir(),'gps-detail-'));
  const parent={truck_number:'Truck 4',tracker_id:'mapped-uuid',timestamp:new Date(end).toISOString(),latitude:30,longitude:-90,
    source_record_id:`v3-position-123-${end}`,delivery_source:'v3_position_push'};
  const payload={date:end,latitude:30,longitude:-90,tracker:{trackerId:123},engineOn:false,
    batchedPositions:`${end-18000},29.9998,-90,3;${end-9000},29.9999,-90,3;`};
  assert.equal(batchedRoutePositions(payload,parent).length,2);
  assert(!('ignition_state' in batchedRoutePositions(payload,parent)[0]),'Earlier positions never inherit current ignition');
  const invalid={...payload,batchedPositions:`bad,30,-90,0;${end},30,-90,0;${end+1},30,-90,0;${end-9000},91,-90,0;${end-9000},,-90,0;${end-9000},30,-90,999;${end-86400001},30,-90,0;`};
  assert.deepEqual(batchedRoutePositions(invalid,parent),[]);
  assert.deepEqual(batchedRoutePositions({...payload,latitude:31},parent),[],'Mismatched parent cannot contribute positions');
  try {
    const history=path.join(root,'history','linxup'),push=path.join(history,'push',date);
    fs.mkdirSync(push,{recursive:true});
    const file=path.join(push,`position-123-${end}.json`);
    fs.writeFileSync(file,JSON.stringify({payload}));
    const source={points:[parent],collection_timestamp:new Date(end).toISOString()};
    fs.writeFileSync(path.join(history,`linxup_location_${date}.json`),JSON.stringify(source));
    const original=JSON.stringify(source);
    const route=readTruckGpsRoute(date,'Truck 4',root,end+1000);
    assert.equal(route.points.length,3);assert.equal(route.paths[0].length,3);
    assert.equal(JSON.stringify(source),original,'Read-back never modifies normalized source');
    assert.equal((withLinxupRouteDetail(source,date,'Truck 9',root) as typeof source).points.length,1,'Truck isolation');
    assert.equal(gpsTripDisplay(route).paths.length,2,'Dense GPS draws immediately before road alignment responds');
    const display=gpsTripDisplay(route).paths;
    assert.equal(continuousGpsDisplayPaths(display).length,1,'Adjacent equal trace edges share a map layer');
    assert.equal(continuousGpsDisplayPaths(display)[0].points.length,3,'Grouping preserves every coordinate');
    assert.equal(continuousGpsDisplayPaths([display[0],{...display[1],sourceEdge:4}]).length,2,'Grouping cannot bridge excluded edges');
    assert.equal(continuousGpsDisplayPaths([display[0],{...display[1],kind:'estimated'}]).length,2,'Keep evidence labels separate');
    assert.equal(display[0].points.length,2,'Grouping does not mutate source geometry');
    let calls=0;
    const roads=await buildStreetRoute(route,async()=>{calls++;return null;});
    assert.equal(calls,0,'Dense recorded trace needs no provider requests');
    assert.equal(roads.status,'available');assert(roads.paths.every(p=>p.kind==='recorded'));
    const visible=await readStreetRoute({...route,truck:'Truck 87'},async()=>{calls++;return null;});
    assert.equal(visible.unmatched,0);assert.equal(visible.paths.length,2);assert.equal(calls,0);
    const sparse={...route,points:[route.points[0],{...route.points[2],timestamp:new Date(end+600000).toISOString()}]};
    sparse.paths=[sparse.points];
    assert.equal(gpsTripDisplay(sparse).paths.length,0,'Sparse fixes never masquerade as a detailed trail');
    const jump={...route,points:[route.points[0],{...route.points[1],latitude:31}]};jump.paths=[jump.points];
    assert.equal(gpsTripDisplay(jump).paths.length,0,'A short time gap cannot authorize an impossible jump');
    fs.writeFileSync(file,JSON.stringify({payload:{...payload,tracker:{trackerId:456}}}));
    assert.equal(readTruckGpsRoute(date,'Truck 4',root,end+1000).points.length,1,'Wrong tracker ignored after cache invalidation');
    fs.writeFileSync(file,'broken');
    assert.equal(readTruckGpsRoute(date,'Truck 4',root,end+1000).points.length,1,'Corrupt raw data retains main history');
    fs.unlinkSync(file);
    assert.equal(readTruckGpsRoute(date,'Truck 4',root,end+1000).points.length,1,'Missing raw data retains main history');
    const malicious={points:[{...parent,source_record_id:'v3-position-../../secret'}]};
    assert.equal((withLinxupRouteDetail(malicious,date,'Truck 4',root) as typeof source).points.length,1);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
  console.log('Detailed GPS replay passed: identity, bounds, malformed data, cache refresh, immediate traces, sparse/jump exclusions, and zero dense-trace provider calls.');
}
void main();
