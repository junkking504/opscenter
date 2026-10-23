import assert from 'node:assert/strict';
import {serviceStreetCandidates,fullFieldStreetAddress} from '../lib/appointment-partner';
import {geocodioAddressQuery} from '../lib/geocodio-service-address';
import {verifyCensusAddress} from '../lib/desktop-address-verification';
import {mapCandidateMatches} from '../lib/address-map-fallback';
import {scheduleDisplayLocator,scheduleMapLocation,type ScheduleAppointment,type ScheduleTruck} from '../desktop-ui/lib/schedule-contract';
import {stopOrderMap} from '../desktop-ui/lib/stop-order-map';
import {appointmentVisitPin} from '../lib/appointment-visit-pin';
import {calculateClosestTrucks,type DesktopAppointment} from '../lib/desktop-schedule';

const address='1234 N I-12 Service Rd W, Apt 135 Metairie, LA 70002';
const candidate={house:'1234',street:'North Interstate 12 Service Road West',city:'Metairie',state:'LA',zip:'70002',latitude:30,longitude:-90.17,source:'Synthetic',sourceUrl:'https://example.org',precision:'building'};
const census={result:{addressMatches:[{matchedAddress:'1234 N INTERSTATE 12 SERVICE RD W, METAIRIE, LA, 70002',addressComponents:{city:'METAIRIE',state:'LA',zip:'70002'},coordinates:{x:-90.17,y:30}}]}};
for(const road of ['I-12','I 12','Interstate 12']) {
 const source=address.replace('I-12',road);
 assert.deepEqual(serviceStreetCandidates(source),[0],'Highway number must not become house number');
 assert.equal(geocodioAddressQuery(source),`1234 N ${road} Service Rd W, Metairie, LA 70002`);
 assert.ok(verifyCensusAddress(source,census).location,'Equivalent interstate spellings match full premises');
 assert.ok(mapCandidateMatches(source,candidate));
 const prefixed='Facility 99, '+source;
 assert.equal(fullFieldStreetAddress(prefixed),source,'Numeric business label does not obscure the service street');
}
for(const source of [address.replace('1234','1235'),address.replace('I-12','I-10'),address.replace(' N ',' S '),address.replace('Rd W','Rd E'),address.replace('70002','70402')]) {
 assert.equal(verifyCensusAddress(source,census).location,null,'House, highway, directions and postal prefix remain exact');
}
assert.equal(verifyCensusAddress(address.replace('70002','70003'),census).reason,'Exact House And Street Verified · Source ZIP Differs','A neighbouring ZIP is reported on the exact premises');
assert.equal(serviceStreetCandidates(address+' or 999 Other St, Metairie, LA 70002').length,2);
assert.equal(geocodioAddressQuery(address+' or 999 Other St, Metairie, LA 70002'),null);
const job={address,territory:'New Orleans',sourceTerritory:'New Orleans',recordId:'one',appointmentId:'one',jkNumber:'JK1',status:'Confirmed',truck:'Unassigned',location:null} as ScheduleAppointment;
const before=JSON.stringify(job);
for(const status of ['Confirmed','Completed','Canceled','Estimate Closed']) for(const source of [address,'','—','not an address','123 Other St, Metairie, TX 75001']) {
 const row={...job,status,address:source};
 const locator=scheduleDisplayLocator(row);
 assert.equal(locator.kind,'area');assert.match(locator.detail,/not been located/);
 assert.ok(Number.isFinite(locator.location.latitude)&&Number.isFinite(locator.location.longitude));
 assert.equal(scheduleMapLocation(row),null,'Area marker cannot enter routing');
 assert.equal(appointmentVisitPin(row),null,'Area marker cannot establish a visit');
}
assert.equal(JSON.stringify(job),before);
const fallback={location:{latitude:30,longitude:-90.17},matchedAddress:'1234 Example St',source:'Synthetic',sourceUrl:'https://example.org',detail:'Approximate building',stale:false};
assert.equal(scheduleDisplayLocator({...job,mapFallback:fallback}).kind,'approximate');
assert.equal(scheduleDisplayLocator({...job,mapFallback:fallback,location:{latitude:30.01,longitude:-90.18}}).kind,'verified');
assert.equal(scheduleDisplayLocator({...job,location:{latitude:NaN,longitude:0}}).kind,'area');
const stops=stopOrderMap([job,{...job,recordId:'two'}],[]);
assert.equal(stops.stops.length,2);assert.equal(stops.missingPins,2);assert.equal(stops.paths.length,0);
async function main(){
 const result=await calculateClosestTrucks(job as DesktopAppointment,[{truck:'Truck 1',latitude:30,longitude:-90,lastGpsUpdate:new Date().toISOString()} as ScheduleTruck],true,async()=>{throw Error('Area-only marker must not call routing');});
 assert.equal(result[0].status,'address_unverified');
 console.log('Mandatory locators PASS: interstate parser and identity guards; all outcomes, cold/missing addresses, precedence, no mutation, routing and GPS isolation.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
