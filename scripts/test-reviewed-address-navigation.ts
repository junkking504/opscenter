import {currentGpsPresence,currentGpsJobLocation} from '../lib/schedule-gps-presence';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {publishReviewedNavigation,readReviewedAddressNavigation,reviewedNavigationFile,validateReviewedNavigation,type ReviewedAddressNavigation} from '../lib/reviewed-address-navigation';
import {readAddressEvidenceFallback as readAddressMapFallback} from '../lib/address-map-fallback';
import {appointmentVisitPin} from '../lib/appointment-visit-pin';
import {planningLocation} from '../lib/planning-geocodes';
import {scheduleMapLocation,needsScheduleAddressVerification} from '../desktop-ui/lib/schedule-contract';
import {osmMapAddressQuery} from '../lib/osm-service-address';
import {appointmentDirectionsHref} from '../lib/appointment-navigation';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'reviewed-navigation-'));
const old={...process.env},oldFetch=globalThis.fetch;
process.env.OPSCENTER_DATA_DIR=process.env.OPSBOT_DATA_DIR=root;
process.env.OSM_ADDRESS_CACHE_DIR=path.join(root,'osm');
process.env.SERVICE_ADDRESS_CACHE_DIR=path.join(root,'verified');
process.env.GEOCODIO_FREE_STATE_FILE=path.join(root,'geocodio.json');
globalThis.fetch=async()=>{throw Error('Navigation review must not call providers');};
const address='123 Example Drive, New Orleans, 70126';
const record:ReviewedAddressNavigation={schema:1,status:'approximate',originalAddress:address,
  matchedAddress:'123 Example Dr, New Orleans, LA 70128',location:{latitude:30.05,longitude:-89.95},
  source:'Synthetic map evidence',sourceUrl:'https://example.com/map',reviewedBy:'Synthetic reviewer',reviewedAt:'2026-01-01T00:00:00Z',visitEligible:false};
try {
 assert.equal(readAddressMapFallback(address),null);
 assert.equal(publishReviewedNavigation(record,root).status,'would-create');
 assert.equal(fs.existsSync(reviewedNavigationFile(address,root)),false,'Dry run writes nothing');
 assert.equal(publishReviewedNavigation(record,root,true).status,'created');
 assert.equal(publishReviewedNavigation(record,root,true).status,'unchanged');
 const before=fs.readFileSync(reviewedNavigationFile(address,root),'utf8');
 assert.throws(()=>publishReviewedNavigation({...record,location:{latitude:30.06,longitude:-89.95}},root,true),/conflicts/);
 assert.equal(fs.readFileSync(reviewedNavigationFile(address,root),'utf8'),before,'Concurrent/repeated conflicting reviews cannot overwrite');
 const pin=readAddressMapFallback(address)!;
 assert.deepEqual(pin.location,record.location);assert.equal(pin.navigationReviewed,true);assert.equal(pin.visitEligible,false);
 assert.match(pin.detail,/entrance unconfirmed/);assert.doesNotMatch(pin.detail,/Not used for arrival or departure/);
 assert.equal(pin.matchedAddress,record.matchedAddress);
 assert.deepEqual(readAddressMapFallback('123 Example Dr New Orleans, LA 70126'),pin,'Punctuation, suffix and LA normalization retain original identity');
 for(const changed of [address.replace('123','124'),address.replace('Drive','Lane'),address.replace('Example','North Example'),address.replace('70126','70128'),address.replace('New Orleans','Slidell'),address.replace('Drive,','Drive Apt 2,')]) {
  assert.equal(readReviewedAddressNavigation(changed),null,'Review is scoped to the entire original source address');
 }
 const job={status:'Confirmed',location:null,mapFallback:pin};
 assert.deepEqual(scheduleMapLocation(job),record.location);
 assert.equal(needsScheduleAddressVerification(job),true);
 assert.equal(planningLocation(address,{}),null,'Navigation evidence never becomes verified property evidence');
 assert.deepEqual(appointmentVisitPin(job)?.location,record.location,'Navigation confidence does not veto GPS operations');
 const now=Date.now(),parked={truck:'Truck 8',...record.location,lastGpsUpdate:new Date(now).toISOString(),speed:0,ignition:'OFF',routePoints:[]};
 const visitJob={...job,appointmentId:'synthetic',truck:'Truck 8'};
 assert.equal(currentGpsPresence(visitJob,[parked],[visitJob],now)?.current,true);
 assert.equal(currentGpsJobLocation(visitJob,[parked],[visitJob],now)?.truck,'Truck 8');
 const verified={latitude:30.051,longitude:-89.951};
 assert.deepEqual(scheduleMapLocation({...job,location:verified}),verified,'Verified property evidence has precedence');
 assert.equal(appointmentVisitPin({...job,location:verified})?.approximate,false);
 const bridge=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/read-appointment-visit-pins.ts'],{input:JSON.stringify([address]),encoding:'utf8',env:process.env}));
 assert.deepEqual(bridge[address].location,record.location,'Python and Schedule use the same selected pin');
 const query=osmMapAddressQuery(address)!;
 const cacheFile=path.join(process.env.OSM_ADDRESS_CACHE_DIR!,createHash('sha256').update('search?'+new URLSearchParams({q:query,format:'jsonv2',addressdetails:'1',limit:'5',countrycodes:'us'})).digest('hex')+'.json');
 fs.mkdirSync(path.dirname(cacheFile),{recursive:true});
 fs.writeFileSync(cacheFile,JSON.stringify({expires:Date.now()+60000,payload:[{osm_type:'way',osm_id:123,category:'highway',addresstype:'road',boundingbox:['30.059','30.061','-89.947','-89.945'],lat:'30.06',lon:'-89.946',address:{road:'Example Drive',city:'New Orleans','ISO3166-2-lvl4':'US-LA',postcode:'70126',country_code:'us'}}]}));
 assert.deepEqual(readAddressMapFallback(address)?.location,record.location,'Reviewed address point wins over a generic street center');
 for(const patch of [{status:'verified'},{visitEligible:true},{sourceUrl:'javascript:alert(1)'},{sourceUrl:'https://user:pass@example.com'},{reviewedBy:''},{reviewedAt:'bad'},{reviewedAt:'2999-01-01T00:00:00Z'},{location:{latitude:0,longitude:0}},{location:{latitude:NaN,longitude:-89.95}},...['124 Example Dr, New Orleans, LA 70128','123 Example Ln, New Orleans, LA 70128','123 North Example Dr, New Orleans, LA 70128','123 Example Dr, Slidell, LA 70128','123 Example Dr, New Orleans, MS 70128','123 Example Dr, New Orleans, LA 70428','123 Example Dr Apt 2, New Orleans, LA 70128'].map(matchedAddress=>({matchedAddress}))]) {
  assert.throws(()=>validateReviewedNavigation({...record,...patch}),'Invalid or mismatched review must be rejected');
 }
 fs.writeFileSync(reviewedNavigationFile(address,root),'{bad');
 assert.equal(readReviewedAddressNavigation(address),null);
 assert.deepEqual(readAddressMapFallback(address)?.location,{latitude:30.06,longitude:-89.946},'Malformed navigation record falls back to ordinary evidence');
 const link=new URL(appointmentDirectionsHref(address)!);
 assert.equal(link.pathname,'/maps/dir/');assert.equal(link.searchParams.get('api'),'1');
 assert.equal(link.searchParams.get('destination'),address,'Directions uses the source address, not a generic map pin or corrected ZIP');
 for(const empty of ['','—','unknown'])assert.equal(appointmentDirectionsHref(empty),null);
 assert.equal(record.originalAddress,address);
 console.log('Reviewed navigation PASS: scoped evidence, precedence, atomic publication, source preservation, GPS coordinate parity and address directions.');
} finally {globalThis.fetch=oldFetch;process.env=old;fs.rmSync(root,{recursive:true,force:true});}
