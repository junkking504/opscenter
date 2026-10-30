import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cleanServiceQuery, legacyServiceQuery, withoutServiceUnit, normalizeServiceAddress, appointmentServiceAddress} from '../lib/service-address-format';
import {mapCandidateMatches,readAddressMapFallback} from '../lib/address-map-fallback';
import {parishAddressQuery,verifyParishAddress} from '../lib/parish-service-address';
import {verifyGeocodioAddress} from '../lib/geocodio-service-address';
import {verifyOsmServiceAddress} from '../lib/osm-service-address';
import {ADDRESS_VERIFICATION_POLICY,cachedAddressVerification} from '../lib/desktop-address-verification';
import {appointmentVisitPin,visitEvidenceLocation} from '../lib/appointment-visit-pin';
import {currentGpsPresence} from '../lib/schedule-gps-presence';

// Synthetic equivalents of the October 15 lot/unit and duplicated-city failures.
// Customer records and provider payloads stay in private task evidence.
const root=fs.mkdtempSync(path.join(os.tmpdir(),'address-unit-locality-'));
const env={...process.env},fetchBefore=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Provider requests forbidden');};
Object.assign(process.env,{OPSCENTER_DATA_DIR:root,OPSBOT_DATA_DIR:root,
  GEOCODIO_FREE_STATE_FILE:path.join(root,'geocodio.json'),SERVICE_ADDRESS_CACHE_DIR:path.join(root,'verified')});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const save=(file:string,data:unknown)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data));};
const now=Date.now(),location={latitude:30.47,longitude:-90.54};
const lot='123 Example Rd Lot 54 Hammond, LA 70403';
const candidate={house:'123',street:'Example Rd Unit 54',city:'Hammond',state:'LA',zip:'70403',...location,source:'Synthetic',sourceUrl:'https://example.invalid',precision:'Provider map location'};
try {
  for(const alias of ['Lot','Trlr','Trailer','Space','Unit','Apt','Suite']) {
    const address=lot.replace('Lot',alias);
    assert.equal(cleanServiceQuery(address),'123 Example Rd Hammond, LA 70403');
    assert.equal(mapCandidateMatches(address,candidate),true);
    assert.equal(mapCandidateMatches(address,{...candidate,street:'Example Rd Unit 55'}),false);
    assert.equal(mapCandidateMatches(address,{...candidate,street:'Example Rd'}),true,'A base entrance is still approximate evidence');
  }
  assert.equal(mapCandidateMatches(lot+' Unit 55',candidate),false,'Multiple explicit unit identities fail closed');
  for(const patch of [{house:'124'},{street:'Other Rd Unit 54'},{street:'N Example Rd Unit 54'},{city:'Covington'},{state:'MS'},{latitude:0,longitude:0}]) {
    assert.equal(mapCandidateMatches(lot,{...candidate,...patch}),false);
  }
  const mapped=appointmentServiceAddress({address:lot,mapAddress:'123 Example Rd, Hammond, LA 70403'});
  assert.match(mapped,/Lot 54/,'Source unit remains the crew instruction');
  assert.equal(lot,'123 Example Rd Lot 54 Hammond, LA 70403');
  for(const street of ['Lot Road','Space Walk','Trailer Park Rd','Lot A Rd']) {
    const address=`123 ${street}, Hammond, LA 70403`;
    assert.equal(withoutServiceUnit(address),address,'A unit label inside the road name is not a unit');
    assert.equal(appointmentServiceAddress({address,mapAddress:address}),address);
  }
  const payload={results:[{address_components:{number:'123',formatted_street:'Example Rd',unit_type:'Trlr',unit_number:'54',city:'Hammond',state_province:'LA',postal_code:'70403',country:'US'},location:{lat:location.latitude,lng:location.longitude},accuracy:1,accuracy_type:'rooftop',match_type:null}]};
  // Only the pre-policy key exists. No new lookup or cache rewrite is needed.
  const ledger={schema:1,cache:{[hash(normalizeServiceAddress(legacyServiceQuery(lot)))]:{expires:now+60000,payload}}};
  save(process.env.GEOCODIO_FREE_STATE_FILE!,ledger);
  const bytes=fs.readFileSync(process.env.GEOCODIO_FREE_STATE_FILE!);
  const fallback=readAddressMapFallback(lot,now)!;
  assert.deepEqual(fallback.location,location);assert.equal(fallback.visitEligible,false);
  assert.match(fallback.matchedAddress,/Unit 54/);
  assert.equal(verifyGeocodioAddress(lot,payload).location,null,'Unit metadata cannot become exact premises verification');
  assert.deepEqual(fs.readFileSync(process.env.GEOCODIO_FREE_STATE_FILE!),bytes,'Cache reader does not rewrite evidence');
  const bridge=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/read-appointment-visit-pins.ts'],{input:JSON.stringify([lot]),encoding:'utf8',env:process.env}));
  assert.deepEqual(bridge[lot].location,location,'Python bridge shares the displayed coordinate');
  for(const evidence of [fallback,{...fallback,visitEligible:undefined},{...fallback,navigationReviewed:true as const}]) {
    assert.deepEqual(appointmentVisitPin({location:null,mapFallback:evidence})?.location,location);
    assert.deepEqual(appointmentVisitPin({location,mapFallback:evidence}),{location,approximate:false});
  }
  assert.deepEqual(visitEvidenceLocation({location},{location,approximate:true}),location,'Recorded coordinates remain usable independent of their label');
  assert.deepEqual(visitEvidenceLocation({location}),location);
  const job={appointmentId:'synthetic',truck:'Truck 3',status:'Confirmed',location:null,mapFallback:fallback};
  const truck={truck:'Truck 3',...location,lastGpsUpdate:new Date(now).toISOString(),speed:0,ignition:'OFF',routePoints:[0,1,2,3,4,5].map(i=>({...location,timestamp:new Date(now-(5-i)*60000).toISOString()}))};
  assert.equal(currentGpsPresence(job,[truck],[job],now)?.current,true);
  assert.equal(currentGpsPresence({...job,location},[truck],[{...job,location}],now)?.current,true);

  const duplicate='123 A Street Covington Covington, LA 70433';
  const normal='123 A Street Covington, LA 70433';
  assert.equal(withoutServiceUnit(duplicate),normal);
  assert.equal(withoutServiceUnit(normal),normal);
  assert.equal(withoutServiceUnit('123 Repeat Repeat St Covington, LA 70433'),'123 Repeat Repeat St Covington, LA 70433');
  assert.equal(withoutServiceUnit('123 Test Rd New Orleans New Orleans, LA 70128'),'123 Test Rd New Orleans, LA 70128');
  assert.equal(withoutServiceUnit('123 Test Rd, Metairie, Metairie, 70001'),'123 Test Rd Metairie, 70001');
  assert.equal(withoutServiceUnit('123 A Street Covington Mandeville, LA 70433'),'123 A Street Covington Mandeville, LA 70433');
  const point={latitude:30.45,longitude:-90.06};
  const parish={spatialReference:{wkid:4326},features:[{attributes:{OBJECTID:123,ADDRESS:'123 A ST',CITY_L:'COVINGTON',ZIP_CODE:70433},geometry:{x:point.longitude,y:point.latitude}}]};
  assert.equal(parishAddressQuery(duplicate)?.url,parishAddressQuery(normal)?.url,'Existing parish cache identity is preserved');
  assert.equal(parishAddressQuery(duplicate)?.expected,'123 A ST');
  assert.deepEqual(verifyParishAddress(duplicate,parish).location,point);
  assert.deepEqual(verifyParishAddress(normal,parish).location,point);
  const geocodio={results:[{address_components:{number:'123',formatted_street:'A St',city:'Covington',state_province:'LA',postal_code:'70433',country:'US'},location:{lat:point.latitude,lng:point.longitude},accuracy:1,accuracy_type:'rooftop',match_type:'building_centroid'}]};
  assert.deepEqual(verifyGeocodioAddress(duplicate,geocodio).location,point);
  const osm={osm_type:'way',osm_id:123,place_rank:30,category:'building',lat:String(point.latitude),lon:String(point.longitude),boundingbox:['30.4499','30.4501','-90.0601','-90.0599'],address:{house_number:'123',road:'A St',city:'Covington',state:'Louisiana',postcode:'70433',country_code:'us'}};
  assert.deepEqual(verifyOsmServiceAddress(duplicate,[osm]).location,point);
  assert.equal(verifyOsmServiceAddress(normal.replace('Street','Street Lot 54'),[{...osm,address:{...osm.address,unit:'55'}}]).location,null,'Conflicting OSM unit cannot pass exact verification');
  for(const address of [duplicate.replace('123','124'),duplicate.replace('A Street','B Street'),duplicate.replace('A Street','N A Street'),duplicate.replace('70433','70434'),duplicate.replace('LA','MS'),duplicate.replace('Covington Covington','Mandeville Mandeville')]) {
    assert.equal(verifyParishAddress(address,parish).location,null,address);
    assert.equal(verifyGeocodioAddress(address,geocodio).location,null,address);
  }
  assert.equal(verifyParishAddress(duplicate,{...parish,features:[...parish.features,{...parish.features[0],attributes:{...parish.features[0].attributes,OBJECTID:124},geometry:{x:-90.07,y:30.46}}]}).location,null);
  save(path.join(process.env.SERVICE_ADDRESS_CACHE_DIR!,hash(duplicate)+'.json'),{schema:ADDRESS_VERIFICATION_POLICY-1,address:duplicate,expires:now+60000,verified:{location:null,reason:'Old failure'}});
  assert.equal(cachedAddressVerification(duplicate),undefined,'Old negative policy cache is re-evaluated');
  save(path.join(process.env.SERVICE_ADDRESS_CACHE_DIR!,hash(normal)+'.json'),{schema:ADDRESS_VERIFICATION_POLICY-1,address:normal,expires:now+60000,verified:verifyParishAddress(normal,parish)});
  assert.deepEqual(cachedAddressVerification(normal)?.location,point,'Valid positive evidence survives policy change');
} finally {process.env=env;globalThis.fetch=fetchBefore;fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS unit/locality normalization, legacy cache reuse, conflicting-unit rejection, exact identity guards and label-independent GPS eligibility; no provider calls.');
