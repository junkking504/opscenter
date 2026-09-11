import assert from 'node:assert/strict';
import {buildStreetRoute,eligibleStreetEdges,gpsSourceVersion,matchedStreetEdges,roadCoordinates} from '../lib/desktop-street-route';
import {osmStreetJson} from '../lib/osm-street-transport';
import type {GpsRoutePoint,TruckGpsRoute} from '../desktop-ui/lib/gps-route-contract';

const points=[0,1,2,3].map(i=>({timestamp:`2026-09-08T13:0${i}:00Z`,latitude:30+i*.001,longitude:-90}));
const route:TruckGpsRoute={date:'2026-09-08',truck:'Truck 9',status:'available',points,paths:[points.slice(0,2),points.slice(2)],gapLinks:[],gaps:1,rejected:0,observedAt:null,coveredThrough:null};
const coords=(p:GpsRoutePoint)=>[p.longitude,p.latitude];
function payload(source:GpsRoutePoint[]){
 return {code:'Ok',tracepoints:source.map((_,waypoint_index)=>({matchings_index:0,waypoint_index,alternatives_count:0})),matchings:[{confidence:.99,legs:source.slice(1).map((p,i)=>({steps:[{geometry:{coordinates:[coords(source[i]),[p.longitude+.0001,(source[i].latitude+p.latitude)/2],coords(p)]}}]}))}]};
}
async function main(){
 assert.deepEqual([...eligibleStreetEdges(route)],[0,2],'outage must never be routed');
 assert.equal(matchedStreetEdges(payload(points),points).size,3);
 const skipped:any=payload(points);skipped.tracepoints[1]=null;
 assert.deepEqual([...matchedStreetEdges(skipped,points).keys()],[2],'outliers are not bridged');
 const split=payload(points);split.tracepoints[2].matchings_index=1;
 assert.equal(matchedStreetEdges(split,points).size,1,'different sub-traces are not bridged');
 const broken=payload(points);broken.matchings[0].legs[0].steps.push({geometry:{coordinates:[[-91,31],coords(points[1])]}});
 assert(!matchedStreetEdges(broken,points).has(0),'disconnected steps cannot add chords');
 assert.equal(roadCoordinates([[-100,40],[-101,41]],points[0],points[1]),null,'distant snapping rejected');
 const original=JSON.stringify(route);let calls=0;
 const result=await buildStreetRoute(route,async path=>{
  calls++;assert(path.startsWith('match/v1/driving/'));assert(!path.includes('Truck'));assert(!path.includes('2026'));
  const p=path.split('/driving/')[1].split('?')[0].split(';').map((p,i)=>{const [longitude,latitude]=p.split(',').map(Number);return {longitude,latitude,timestamp:points[i].timestamp};});
  assert.equal(p.length,2,'do not send excluded gaps for road inference');return payload(p);
 });
 assert.deepEqual(result.paths.map(path=>path.sourceEdge),[0,2],'Geometry retains its source edge for trip colors');
 assert.equal(calls,2);assert.equal(result.paths.length,2);assert.equal(result.status,'available');assert(result.paths.every(p=>p.kind==='matched'));
 assert.equal(JSON.stringify(route),original,'exact GPS coordinates unchanged');
 assert.notEqual(gpsSourceVersion(route),gpsSourceVersion({...route,truck:'Truck 6'}));
 const failed=await buildStreetRoute(route,async()=>null);assert.equal(failed.status,'unavailable');assert.equal(failed.paths.length,0);assert.equal(failed.unmatched,2);
 const estimated=await buildStreetRoute(route,async path=>{
  if(path.startsWith('match'))return {code:'NoMatch'};
  const p=path.split('/driving/')[1].split('?')[0].split(';').map(p=>p.split(',').map(Number));
  return {code:'Ok',routes:[{geometry:{coordinates:[p[0],[p[0][0]+.0001,(p[0][1]+p[1][1])/2],p[1]]}}]};
 });
 assert.equal(estimated.paths.length,2);assert(estimated.paths.every(p=>p.kind==='estimated'));
 const ambiguous=payload(points);ambiguous.matchings[0].confidence=.2;
 assert([...matchedStreetEdges(ambiguous,points).values()].every(p=>p.kind==='estimated'));
 const actualFetch=globalThis.fetch,starts:number[]=[];
 try {
  globalThis.fetch=async input=>{assert(String(input).startsWith('https://routing.openstreetmap.de/'));starts.push(Date.now());return Response.json({code:'Ok'});};
  await Promise.all([osmStreetJson('test-one'),osmStreetJson('test-one'),osmStreetJson('test-two')]);
  await osmStreetJson('test-one');assert.equal(starts.length,2,'simultaneous and completed requests are reused');
  assert(starts[1]-starts[0]>=1000,'respect public provider rate limit');
 } finally {globalThis.fetch=actualFetch;}
 console.log('Street route checks passed: road geometry, no chords, gaps, outliers, estimated fallback, exact GPS, identity, cache and rate limit.');
}
void main();
