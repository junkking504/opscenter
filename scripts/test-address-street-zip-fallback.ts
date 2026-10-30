import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readAddressEvidenceFallback as readAddressMapFallback} from '../lib/address-map-fallback';
import {appointmentVisitPin} from '../lib/appointment-visit-pin';
import {osmMapAddressQuery,verifyOsmServiceAddress} from '../lib/osm-service-address';
import {geocodioAddressQuery,verifyGeocodioAddress} from '../lib/geocodio-service-address';
import {normalizeServiceAddress} from '../lib/service-address-format';
import {planningLocation} from '../lib/planning-geocodes';
import {serviceTerritory} from '../lib/service-territory';
import {scheduleMapLocation,needsScheduleAddressVerification} from '../desktop-ui/lib/schedule-contract';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'street-zip-fallback-'));
const old={...process.env}, originalFetch=globalThis.fetch;
process.env.OPSBOT_DATA_DIR=process.env.OPSCENTER_DATA_DIR=root;
process.env.OSM_ADDRESS_CACHE_DIR=path.join(root,'osm');
process.env.GEOCODIO_FREE_STATE_FILE=path.join(root,'geocodio.json');
process.env.GEOCODIO_FREE_CONFIG_FILE='/dev/null';
process.env.SERVICE_ADDRESS_CACHE_DIR=path.join(root,'verified');
globalThis.fetch=async()=>{throw Error('Cache fallback must never make a provider request');};
const now=Date.now(), hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const address='123 Example Drive New Orleans, LA 70126';
const road={osm_type:'way',osm_id:123,lat:'30.0600',lon:'-89.9460',category:'highway',addresstype:'road',boundingbox:['30.059','30.061','-89.947','-89.945'],address:{road:'Example Drive',city:'New Orleans',state:'Louisiana','ISO3166-2-lvl4':'US-LA',postcode:'70128',country_code:'us'}};
const center={address_components:{formatted_street:'Example Dr',city:'New Orleans',state_province:'LA',postal_code:'70128',country:'US'},location:{lat:30.0601,lng:-89.9461},accuracy:0.69,accuracy_type:'street_center'};
const save=(file:string,data:unknown)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data));};
const osmFile=(a=address)=>path.join(process.env.OSM_ADDRESS_CACHE_DIR!,hash('search?'+new URLSearchParams({q:osmMapAddressQuery(a)!,format:'jsonv2',addressdetails:'1',limit:'5',countrycodes:'us'}))+'.json');
const saveRoad=(rows:unknown[]= [road],expires=now+60000,a=address)=>save(osmFile(a),{expires,payload:rows});
const saveCenter=(rows:unknown[]=[center],expires=now+60000,a=address)=>save(process.env.GEOCODIO_FREE_STATE_FILE!,{schema:1,cache:{[hash(normalizeServiceAddress(geocodioAddressQuery(a)!))]:{expires,payload:{results:rows}}}});
const read=(a=address)=>readAddressMapFallback(a,now);
try {
 saveRoad();
 assert.equal(read(),null,'ZIP conflict needs corroboration; do not relax single-provider street matching');
 saveCenter();
 const pin=read()!;
 assert.ok(pin,'Existing agreeing caches recover a bounded street estimate despite a source ZIP conflict');
 assert.deepEqual(pin.location,{latitude:30.06,longitude:-89.946});
 assert.equal(pin.matchedAddress,'Example Drive, New Orleans, LA 70128','Never put the unlocated source house on provider evidence');
 assert.match(pin.detail,/house number not located/);assert.match(pin.detail,/Source ZIP differs/);
 assert.equal(pin.visitEligible,false);
 assert.equal(planningLocation(address,{}),null);
 assert.equal(verifyOsmServiceAddress(address,[road]).location,null);
 assert.equal(verifyGeocodioAddress(address,{results:[center]}).location,null);
 assert.equal(verifyOsmServiceAddress(address.replace('70126','70128'),[road]).location,null,'Correcting a ZIP does not locate a house');
 assert.equal(verifyGeocodioAddress(address.replace('70126','70128'),{results:[center]}).location,null);
 const job={status:'Confirmed',location:null,mapFallback:pin};
 assert.deepEqual(scheduleMapLocation(job),pin.location);
 assert.equal(needsScheduleAddressVerification(job),true);
 assert.deepEqual(appointmentVisitPin(job)?.location,pin.location,'GPS policy uses the displayed coordinate regardless of label');
 assert.equal(appointmentVisitPin({...job,location:pin.location})?.approximate,false,'Later verified coordinates win');
 const bridge=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/read-appointment-visit-pins.ts'],{input:JSON.stringify([address]),encoding:'utf8',env:process.env}));
 assert.deepEqual(bridge[address].location,pin.location,'Python and Schedule consume the same coordinate');
 for(const zip of ['70126','70128'])assert.equal(serviceTerritory(address.replace('70126',zip)).area,'East Metro','Dispatch territory does not imply a located property');
 saveRoad([],now+60000);assert.equal(read(),null,'Geocodio street center alone has no bounded street evidence');saveRoad();
 for(const patch of [{accuracy_type:'place'},{accuracy_type:'nearest_rooftop_match'},{accuracy:0.2},{location:{lat:30.08,lng:-89.946}},{location:{lat:30.0601,lng:-89.9449}},{location:{lat:NaN,lng:-89.946}}]) {
  saveCenter([{...center,...patch}]);assert.equal(read(),null,'Wrong precision, distant or invalid corroboration cannot create a pin');
 }
 for(const patch of [{number:'999'},{unit_number:'2'},{formatted_street:'Example Lane'},{formatted_street:'North Example Dr'},{city:'Slidell'},{state_province:'MS'},{postal_code:'70127'},{country:'CA'}]) {
  saveCenter([{...center,address_components:{...center.address_components,...patch}}]);assert.equal(read(),null,'Corroboration must retain full street, city, state, ZIP and no house/unit');
 }
 saveCenter([center,{...center,location:{lat:30.09,lng:-89.946}}]);assert.equal(read(),null,'Competing street-center results do not establish agreement');
 saveRoad([{...road,boundingbox:['30.05','30.07','-89.95','-89.94']}]);
 saveCenter([{...center,location:{lat:30.065,lng:-89.946}}]);assert.equal(read(),null,'Centers over 150 metres apart do not corroborate even inside road bounds');saveRoad();
 saveCenter([center],now-1);assert.equal(read(),null,'Expired corroboration is insufficient');saveCenter();
 saveRoad([road],now-1);assert.equal(read(),null,'Expired road evidence is insufficient');saveRoad();
 for(const patch of [{address:{...road.address,road:'Example Lane'}},{address:{...road.address,road:'North Example Drive'}},{address:{...road.address,city:'Slidell'}},{address:{...road.address,'ISO3166-2-lvl4':'US-MS'}},{category:'place'},{osm_id:null},{boundingbox:['29','32','-91','-89']},{lat:'0'}]) {
  saveRoad([{...road,...patch}]);assert.equal(read(),null,'Do not turn different streets, cities, directions, states, centroids or invalid geometry into pins');
 }
 saveRoad([road,{...road,osm_id:456}]);assert.equal(read(),null,'Two matching roads remain ambiguous');
 saveRoad([road,{...road,lat:'30.0605'}]);assert.equal(read(),null,'Conflicting geometry for one road remains ambiguous');
 saveRoad([road,road]);assert.ok(read(),'Identical duplicates do not create false ambiguity');
 const correctZip=address.replace('70126','70128');
 saveRoad();assert.ok(read(correctZip),'Ordinary matching-ZIP street behavior stays intact');
 assert.equal(read(correctZip)?.visitEligible,false);
 const differentPrefix=address.replace('70126','70426');saveCenter([center],now+60000,differentPrefix);
 assert.equal(read(differentPrefix),null,'Do not cross postal regions on street-only evidence');
 saveCenter();
 const noState='123 Example Drive, New Orleans, 70126';saveRoad([road],now+60000,noState);saveCenter([center],now+60000,noState);
 assert.ok(read(noState),'Original collected source without explicit LA uses the same guarded fallback');
 saveCenter();
 const house={...road,category:'building',address:{...road.address,house_number:'123'},lat:'30.0605'};
 saveRoad([road,house]);assert.equal(read()?.location.latitude,30.0605,'House evidence always outranks the new street estimate');
 assert.equal(read()?.visitEligible,false);
 assert.equal(address,'123 Example Drive New Orleans, LA 70126','Source address stays unchanged');
 console.log('Street ZIP fallback PASS: corroboration, false-pin guards, exact verification, territory, operational coordinate parity and source preservation.');
} finally {
 globalThis.fetch=originalFetch;process.env=old;fs.rmSync(root,{recursive:true,force:true});
}
