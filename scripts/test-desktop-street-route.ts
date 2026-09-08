import assert from 'node:assert/strict';
import {buildStreetRoute,eligibleStreetEdges,gpsSourceVersion,routeCoordinates,snappedStreetEdges} from '../lib/desktop-street-route';
import {validTile,validViewport} from '../lib/google-map-tiles';
import type {RoadCoordinate,TruckGpsRoute} from '../desktop-ui/lib/gps-route-contract';

async function main(){
const points=[0,1,2,3].map(i=>({timestamp:`2026-09-08T13:0${i}:00Z`,latitude:30+i*.001,longitude:-90}));
const route:TruckGpsRoute={date:'2026-09-08',truck:'Truck 9',status:'available',points,paths:[points.slice(0,2),points.slice(2)],gapLinks:[],gaps:1,rejected:0,observedAt:null,coveredThrough:null};
assert.deepEqual([...eligibleStreetEdges(route)],[0,2],'outage between observations 1 and 2 is never eligible');
const payload={snappedPoints:points.map((location,originalIndex)=>({location,originalIndex}))};
assert.equal(snappedStreetEdges(payload,points).size,3);
assert.deepEqual([...snappedStreetEdges({snappedPoints:payload.snappedPoints.filter(p=>p.originalIndex!==1)},points).keys()],[2],'a skipped original index must not be bridged');
assert.equal(snappedStreetEdges({snappedPoints:[{originalIndex:0,location:points[0]},{originalIndex:1,location:{...points[1],latitude:31}}]},points).size,0,'remote snapping rejected');
const sparse=[points[0],{...points[1],latitude:30.1}];
assert.equal(snappedStreetEdges({snappedPoints:sparse.map((location,originalIndex)=>({location,originalIndex}))},sparse).size,0,'uninterpolated long chord rejected');
const original=JSON.stringify(route);
const matched=await buildStreetRoute(route,async()=>payload);
assert.equal(matched.paths.length,2);assert(matched.paths.every(p=>p.kind==='matched'));
assert.equal(JSON.stringify(route),original,'raw GPS coordinates must remain untouched');
assert.notEqual(gpsSourceVersion(route),gpsSourceVersion({...route,truck:'Truck 6'}));
const failed=await buildStreetRoute(route,async()=>null);assert.equal(failed.status,'unavailable');assert.equal(failed.unmatched,2);
const estimate=await buildStreetRoute(route,async(host,_path,body)=>{
 if(host==='roads.googleapis.com')return null;
 const request=body as {origin:{location:{latLng:RoadCoordinate}};destination:{location:{latLng:RoadCoordinate}}};
 const a=request.origin.location.latLng,b=request.destination.location.latLng;
 assert(!('timestamp' in a));
 return {routes:[{polyline:{geoJsonLinestring:{coordinates:[[a.longitude,a.latitude],[a.longitude+.0001,(a.latitude+b.latitude)/2],[b.longitude,b.latitude]]}}}]};
});
assert.equal(estimate.paths.length,2);assert(estimate.paths.every(p=>p.kind==='estimated'));
assert.equal(routeCoordinates({routes:[{polyline:{geoJsonLinestring:{coordinates:[[-100,40],[-101,41]]}}}]},points[0],points[1]),null);
assert.equal(validTile(new URLSearchParams('z=4&x=16&y=0')),null);
assert.equal(validTile(new URLSearchParams('z=-1&x=0&y=0')),null);
assert.deepEqual(validTile(new URLSearchParams('z=4&x=15&y=0')),{z:4,x:15,y:0});
assert.equal(validViewport(new URLSearchParams('zoom=15&north=30&south=31&east=-90&west=-91')),null);
assert.equal(validViewport(new URLSearchParams('zoom=15&north=NaN&south=29&east=-90&west=-91')),null);
assert(validViewport(new URLSearchParams('zoom=15&north=31&south=29&east=-90&west=-91')));
console.log('Street route checks passed: isolated gaps, matched geometry, estimated fallback, source identity, exact GPS, API bounds.');
}
void main();
