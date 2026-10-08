import assert from 'node:assert/strict';
import {osmTravelMatrix} from '../lib/osm-travel-matrix';
import {calculateDesktopRouteLegs,type DesktopAppointment} from '../lib/desktop-schedule';
const origin={latitude:30,longitude:-90},destination={latitude:30.01,longitude:-90.01};
const valid={code:'Ok',routes:[{duration:615.2,distance:3218.688}],waypoints:[{distance:2},{distance:5}]};
async function main(){
 let count=0;
 const send=async(path:string)=>{count++;assert(path.startsWith('route/v1/driving/-90,30;-90.01,30.01?'));assert(!path.includes('google'));return valid;};
 const rows=await osmTravelMatrix([origin],[destination],send);
 assert.deepEqual(rows,[{originIndex:0,destinationIndex:0,condition:'ROUTE_EXISTS',duration:'615.2s',distanceMeters:3218.688}]);assert.equal(count,1);
 const geometry=[[origin.longitude,origin.latitude],[-90.005,30.003],[destination.longitude,destination.latitude]];
 const mapped=await osmTravelMatrix([origin],[destination],async path=>{assert(path.includes('overview=full&geometries=geojson'));return {...valid,routes:[{...valid.routes[0],geometry:{coordinates:geometry}}]};});
 assert.deepEqual(mapped?.[0].geometry,geometry.map(([longitude,latitude])=>({latitude,longitude})));
 const badGeometry=await osmTravelMatrix([origin],[destination],async()=>({...valid,routes:[{...valid.routes[0],geometry:{coordinates:[[0,0],[1,1]]}}]}));
 assert.equal(badGeometry?.[0].geometry,undefined,'Invalid road geometry cannot produce a map route');
 for(const data of [null,{code:'NoRoute'},{...valid,routes:[{duration:null,distance:3}]},{...valid,routes:[{duration:-1,distance:3}]},{...valid,routes:[{duration:10,distance:NaN}]},{...valid,waypoints:[{distance:151},{distance:0}]}])assert.deepEqual(await osmTravelMatrix([origin],[destination],async()=>data),[]);
 assert.equal(await osmTravelMatrix([{latitude:NaN,longitude:-90}],[destination],async()=>{throw Error('invalid GPS must not reach provider');}),null);
 assert.equal((await osmTravelMatrix([origin],[destination],async()=>({...valid,routes:[{duration:0,distance:0}]})))?.[0].duration,'0s');
 const partial=await osmTravelMatrix([origin,destination],[destination],async path=>{assert(path.startsWith('table/'));assert(!path.includes('fallback_speed'));return {code:'Ok',durations:[[null],[120]],distances:[[null],[1000]],sources:[{distance:0},{distance:0}],destinations:[{distance:0}]};});assert.equal(partial?.length,1);assert.equal(partial?.[0].originIndex,1);
 const jobs=[origin,destination].map((location,i)=>({recordId:`a${i}`,jkNumber:`JK${i}`,truck:'Truck 3',status:'Confirmed',appointmentStartMinutes:480+i*90,appointmentEndMinutes:540+i*90,location}) as DesktopAppointment);
 const legs=await calculateDesktopRouteLegs(jobs,(a,b)=>osmTravelMatrix(a,b,send));
 assert.equal(legs[0].travelMinutes,11);assert.equal(legs[0].miles,2);assert.equal(legs[0].bufferMinutes,19);assert.equal(legs[0].source,'osm_road_estimate');
 const mappedLegs=await calculateDesktopRouteLegs(jobs,async()=>mapped);assert.deepEqual(mappedLegs[0].geometry,mapped?.[0].geometry,'Route response carries geometry from the same road estimate request');
 console.log('OSM ETA checks passed: provider duration/distance, identity, units, no traffic claim, invalid data, unavailable routes and no fabricated fallback.');
}
void main();
