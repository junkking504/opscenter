import assert from 'node:assert/strict';
import {calculateClosestTrucks,calculateDesktopRouteLegs,type DesktopAppointment} from '../lib/desktop-schedule';
import {calculateTruckProgress} from '../lib/desktop-truck-progress';
import {needsScheduleAddressVerification,unavailableRoute,type ScheduleTruck} from '../desktop-ui/lib/schedule-contract';
import {stopOrderMap} from '../desktop-ui/lib/stop-order-map';
async function main() {
 const now=Date.parse('2026-10-10T17:30:00Z');
 const point={latitude:30.45,longitude:-90.05},verified={latitude:30.4,longitude:-90.1};
 const job={recordId:'approx',appointmentId:'approx',version:'1',jkNumber:'JK1',truck:'Truck 8',status:'Confirmed',appointmentType:'Job',appointmentStartMinutes:660,appointmentEndMinutes:720,location:null,mapFallback:{location:point,matchedAddress:'123 Example Ln',source:'Parish',sourceUrl:'https://example.org',detail:'Possible correction',stale:false}} as DesktopAppointment;
 const first={...job,recordId:'first',appointmentId:'first',jkNumber:'JK0',appointmentStartMinutes:540,appointmentEndMinutes:600,location:verified,mapFallback:null};
 const gps={truck:'Truck 8',latitude:30.5,longitude:-90.1,lastGpsUpdate:new Date(now-10000).toISOString(),speed:20,ignition:'ON'} as ScheduleTruck;
 const before=JSON.stringify(job);
 const provider:Parameters<typeof calculateClosestTrucks>[3]=async(_origins,destinations)=>{
  assert.deepEqual(destinations,[point]);
  return [{condition:'ROUTE_EXISTS',duration:'601s',distanceMeters:8000,geometry:[verified,point]}];
 };
 const closest=await calculateClosestTrucks(job,[gps],true,provider);
 assert.equal(closest[0].minutes,11);assert.equal(closest[0].approximate,true);
 const legs=await calculateDesktopRouteLegs([first,job],provider);
 assert.equal(legs[0].travelMinutes,11);assert.equal(legs[0].approximate,true);
 assert.equal(stopOrderMap([first,job],legs).paths.length,1,'Provider road geometry may connect an approximate pin');
 const progress=await calculateTruckProgress([job],[gps],true,provider,now);
 assert.equal(progress[0].minutes,11);assert.equal(progress[0].approximate,true);assert.equal(progress[0].arrivalAt,'2026-10-10T17:40:01.000Z');
 assert.equal(JSON.stringify(job),before,'Routing must not mutate verified location, assignment, or visit evidence');
 assert.equal(needsScheduleAddressVerification(job),true);
 const exact=await calculateClosestTrucks({...job,location:verified},[gps],true,async(_o,d)=>{assert.deepEqual(d,[verified]);return [{condition:'ROUTE_EXISTS',duration:'300s',distanceMeters:1000}];});
 assert.equal(exact[0].approximate,false,'Exact coordinates supersede the candidate');
 const missing={...job,mapFallback:null};
 assert.equal((await calculateClosestTrucks(missing,[gps],true,async()=>{throw Error('Must not route missing points');}))[0].status,'address_unverified');
 const failed=await calculateDesktopRouteLegs([first,job],async()=>null);
 assert.equal(failed[0].travelMinutes,null);assert.equal(unavailableRoute(failed[0],[first,job]).label,'ETA Unavailable');
 assert.equal((await calculateTruckProgress([job],[{...gps,lastGpsUpdate:new Date(now-3600000).toISOString()}],true,provider,now))[0].status,'stale_gps');
 assert.equal((await calculateTruckProgress([job],[{...gps,speed:0,ignition:'OFF'}],true,provider,now))[0].status,'parked');
 console.log('Approximate ETA PASS: candidate routing, labeled confidence, exact precedence, no mutation, missing providers and GPS freshness.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
