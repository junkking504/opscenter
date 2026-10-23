import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {cleanServiceQuery,legacyServiceQuery,normalizeServiceAddress,serviceUnitIdentifiers,appointmentServiceAddress} from '../lib/service-address-format';
import {readAddressMapFallback} from '../lib/address-map-fallback';
import {ADDRESS_VERIFICATION_POLICY,cachedAddressVerification,verifyCensusAddress} from '../lib/desktop-address-verification';
import {verifyGeocodioAddress} from '../lib/geocodio-service-address';
import {appointmentVisitPin} from '../lib/appointment-visit-pin';
import {planningLocation} from '../lib/planning-geocodes';
import {scheduleDisplayLocator,scheduleMapLocation,type ScheduleAppointment} from '../desktop-ui/lib/schedule-contract';

// Synthetic equivalents of Number 146 and 880N Hwy 190. Actual appointment
// addresses and saved provider evidence remain outside Git in the task packet.
const unit='1200 Example Lake Boulevard Number 146 SLIDELL, LA 70460';
const highway='880N Hwy 191 COVINGTON, LA 70433';
const point={latitude:30.44,longitude:-90.08};
const result=(number:string,street:string,city:string,zip:string,extra={})=>({
  address_components:{number,formatted_street:street,city,postal_code:zip,state_province:'LA',country:'US',...extra},
  location:{lat:point.latitude,lng:point.longitude},accuracy:1,accuracy_type:'rooftop',match_type:'building_centroid',
});
const unitResult=result('1200','Example Lake Blvd','Slidell','70460',{unit_type:'Trlr',unit_number:'146'});
const highwayResult=result('880','N US-191','Covington','70433');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'address-number-highway-'));
const before={env:{...process.env},fetch:globalThis.fetch};
let calls=0;
globalThis.fetch=async()=>{calls++;throw Error('Network forbidden');};
Object.assign(process.env,{OPSBOT_DATA_DIR:root,OPSCENTER_DATA_DIR:root,SERVICE_ADDRESS_CACHE_DIR:path.join(root,'verified'),
  GEOCODIO_FREE_CONFIG_FILE:'/dev/null',GEOCODIO_FREE_STATE_FILE:path.join(root,'geocodio.json')});
const now=Date.now(),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const save=(file:string,data:unknown)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data));};
const cache=(address:string,rows:unknown[],expires=now+60_000)=>save(process.env.GEOCODIO_FREE_STATE_FILE!,{
  schema:1,cache:{[hash(normalizeServiceAddress(legacyServiceQuery(address)))]:{expires,payload:{results:rows}}},
});
try {
  assert.equal(cleanServiceQuery(unit),'1200 Example Lake Boulevard SLIDELL, LA 70460');
  assert.deepEqual(serviceUnitIdentifiers(unit),['146']);
  assert.equal(legacyServiceQuery(unit),unit,'Pre-policy provider evidence remains readable');
  assert.match(appointmentServiceAddress({address:unit,mapAddress:'1200 Example Lake Blvd, Slidell, LA 70460'}),/Number 146/);
  for(const address of ['1200 Number 146 Rd, Slidell, LA 70460','1200 Highway Number 191, Slidell, LA 70460','1200 Number One Blvd, Slidell, LA 70460'])
    assert.equal(cleanServiceQuery(address),address,'Number in the road name is not a unit');
  cache(unit,[unitResult]);
  const bytes=fs.readFileSync(process.env.GEOCODIO_FREE_STATE_FILE!);
  const fallback=readAddressMapFallback(unit,now)!;
  assert.deepEqual(fallback.location,point);
  assert.match(fallback.matchedAddress,/Unit 146/);
  assert.match(fallback.detail,/Unit entrance not located/);
  assert.equal(verifyGeocodioAddress(unit,{results:[unitResult]}).location,null,'Provider unit cannot become exact premises');
  for(const bad of [unit.replace('146','147'),unit.replace('1200','1201'),unit.replace('Lake','Other'),unit+' Unit 147']) {
    cache(bad,[unitResult]); assert.equal(readAddressMapFallback(bad,now),null,bad);
  }
  cache(unit,[{...unitResult,address_components:{...unitResult.address_components,unit_number:'147'}}]);
  assert.equal(readAddressMapFallback(unit,now),null,'Do not select another unit');
  cache(unit,[unitResult]);
  assert.deepEqual(fs.readFileSync(process.env.GEOCODIO_FREE_STATE_FILE!),bytes);

  assert.equal(cleanServiceQuery(highway),highway,'Do not rewrite ambiguous source or provider query');
  cache(highway,[highwayResult]);
  const road=readAddressMapFallback(highway,now)!;
  assert.deepEqual(road.location,point);
  assert.match(road.detail,/interpreted as a highway direction.*unverified/);
  assert.equal(verifyGeocodioAddress(highway,{results:[highwayResult]}).location,null);
  assert.equal(verifyCensusAddress(highway,{result:{addressMatches:[{matchedAddress:'880 N US-191, COVINGTON, LA, 70433',
    addressComponents:{city:'COVINGTON',state:'LA',zip:'70433'},coordinates:{x:point.longitude,y:point.latitude}}]}}).location,null);
  for(const patch of [{number:'881'},{number:'808'},{formatted_street:'S US-191'},{formatted_street:'US-191'},
    {formatted_street:'N US-190'},{formatted_street:'N Example Rd'},{city:'Slidell'},{state_province:'MS'},
    {country:'CA'},{postal_code:'70434'},{unit_type:'Apt',unit_number:'N'}]) {
    cache(highway,[{...highwayResult,address_components:{...highwayResult.address_components,...patch}}]);
    assert.equal(readAddressMapFallback(highway,now),null,JSON.stringify(patch));
  }
  for(const patch of [{accuracy_type:'nearest_rooftop_match'},{accuracy_type:'range_interpolation'},
    {accuracy_type:'street_center'},{accuracy:0.99},{match_type:'unit_centroid'},
    {location:{lat:0,lng:0}}]) {
    cache(highway,[{...highwayResult,...patch}]);assert.equal(readAddressMapFallback(highway,now),null,JSON.stringify(patch));
  }
  for(const bad of [highway.replace('880N','880A'),highway.replace('880N','880NN'),highway.replace('880N','880-N'),
    highway.replace('880N','880 N'),highway.replace('Hwy','LA Hwy'),highway.replace('LA 70433','MS 70433'),
    highway.replace('70433','70434'),highway+' or 882 Other Rd, Covington, LA 70433']) {
    cache(bad,[highwayResult]);assert.equal(readAddressMapFallback(bad,now),null,bad);
  }
  cache(highway,[highwayResult,{...highwayResult,location:{lat:30.45,lng:-90.07}}]);
  assert.equal(readAddressMapFallback(highway,now),null,'Competing premises stay unresolved');
  cache(highway,[highwayResult,{...highwayResult,address_components:{...highwayResult.address_components,formatted_street:'N LA-191'}}]);
  assert.equal(readAddressMapFallback(highway,now),null,'Conflicting route jurisdictions stay unresolved');
  cache(highway,[highwayResult,highwayResult]);
  assert.ok(readAddressMapFallback(highway,now),'Identical duplicate evidence is not ambiguity');
  cache(highway,[highwayResult],now-60_000);
  assert.equal(readAddressMapFallback(highway,now)?.stale,true);
  cache(highway,[highwayResult],now-8*86400_000);
  assert.equal(readAddressMapFallback(highway,now),null,'Expired evidence cannot outlive the existing grace');

  for(const [address,mapFallback] of [[unit,fallback],[highway,road]] as const) {
    const job={address,mapFallback,location:null,territory:'Northshore'} as ScheduleAppointment;
    assert.equal(scheduleDisplayLocator(job).kind,'approximate');
    assert.deepEqual(scheduleMapLocation(job),point,'Existing approximate travel path receives provider point');
    assert.equal(appointmentVisitPin(job),null);
    assert.equal(planningLocation(address,{}),null,'Display fallback cannot enter verified cache');
    assert.equal(scheduleDisplayLocator({...job,mapFallback:null}).kind,'area');
    assert.equal(scheduleMapLocation({...job,mapFallback:null}),null,'Territory center cannot enter travel');
    save(path.join(process.env.SERVICE_ADDRESS_CACHE_DIR!,hash(address)+'.json'),{
      schema:ADDRESS_VERIFICATION_POLICY-1,address,expires:now+60_000,verified:{location:null,reason:'Old failure'},
    });
    assert.equal(cachedAddressVerification(address),undefined,'Old negative policy retries through the existing worker');
  }
  assert.equal(calls,0,'No geocoder or routing requests');
  console.log('PASS Number-unit and compact-highway cache recovery; near misses, competing premises, stale evidence, verified/visit isolation; zero provider calls.');
} finally {process.env=before.env;globalThis.fetch=before.fetch;fs.rmSync(root,{recursive:true,force:true});}
