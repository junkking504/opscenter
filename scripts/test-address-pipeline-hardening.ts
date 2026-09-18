import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyCensusAddress, verifyDesktopAddress, cachedAddressVerification, ADDRESS_VERIFICATION_POLICY } from '../lib/desktop-address-verification';
import { appointmentServiceAddress, cleanServiceQuery } from '../lib/service-address-format';
import { serviceStreetCandidates, fullFieldStreetAddress } from '../lib/appointment-partner';
import { verifyOsmServiceAddress } from '../lib/osm-service-address';
import { planningLocation } from '../lib/planning-geocodes';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'address-hardening-'));
process.env.OPSBOT_DATA_DIR=root;
process.env.OPSCENTER_DATA_DIR=root;
process.env.SERVICE_ADDRESS_CACHE_DIR=path.join(root,'verifications');
process.env.OSM_ADDRESS_CACHE_DIR=path.join(root,'osm');
const point={latitude:29.95,longitude:-90.1};
function match(street='100 EXAMPLE ST',streetName='EXAMPLE') {
  return {matchedAddress:`${street}, NEW ORLEANS, LA, 70125`,addressComponents:{zip:'70125',city:'NEW ORLEANS',state:'LA',streetName,suffixType:'ST'},coordinates:{x:point.longitude,y:point.latitude},tigerLine:{tigerLineId:'synthetic-segment',side:'R'}};
}
const fixture=(street?:string)=>({result:{addressMatches:[match(street)]}});
const verify=(source:string,street?:string)=>verifyCensusAddress(source,fixture(street));
for(const input of [
  '100 Example St Other City LA 70125','100 Example St New Orleans MS 70125',
  '98-100 Example St New Orleans LA 70125','98 - 100 Example St New Orleans LA 70125',
  '100 1/2 Example St New Orleans LA 70125','100½ Example St New Orleans LA 70125',
  '100AB Example St New Orleans LA 70125','100 Example St New Orleans LA',
]) assert.equal(verify(input).location,null,`Cannot collapse or discard source identity: ${input}`);
assert.equal(verify('100 1/2 Example St New Orleans LA 70125','2 EXAMPLE ST').location,null,'Never extract the fraction denominator');
assert.equal(verify('100/2 Example St New Orleans LA 70125','2 EXAMPLE ST').location,null,'Malformed fraction cannot yield a denominator pin');
assert.equal(verify('100 One Hundred First St New Orleans LA 70125','100 102ND ST').location,null);
for(const house of ['100AB','98-100','98 - 100','100 1/2','100½']) {
  const matchedHouse=house==='100½'?'100 1/2':house;
  const address=`Example Facility 84, ${house} Example St Apt #B New Orleans LA 70125`;
  assert.ok(verify(address,`${matchedHouse} EXAMPLE ST`).location,`Whole house accepted with matching evidence: ${house}`);
  assert.equal(serviceStreetCandidates(address).length,1);
  assert.ok(fullFieldStreetAddress(address).startsWith(house),'Extraction retains the full identifier');
  assert.equal(serviceStreetCandidates(`${address} or 200 Example St New Orleans LA 70125`).length,2);
}
for(const [written,numeric] of [['One Hundred First','101ST'],['One Hundred And Eleventh','111TH'],['Two Hundredth','200TH'],['One Thousand First','1001ST'],['Nine Thousand Nine Hundred Ninety Ninth','9999TH']]) {
  assert.ok(verify(`100 ${written} St New Orleans LA 70125`,`100 ${numeric} ST`).location,written);
  assert.ok(verify(`100 ${numeric} St New Orleans LA 70125`,`100 ${written.toUpperCase()} ST`).location,'Provider may use words too');
}
assert.ok(verify('Example Apartments 100 Example New Orleans LA 70125').location, 'Business prefix with omitted road type still matches whole street and locality');
assert.equal(verify('Business 84 Location 2 100 Example New Orleans LA 70125').location,null, 'Do not skip ambiguous numeric business labels without a full street candidate');
assert.ok(verify('100 Northeast Example St New Orleans LA 70125','100 NE EXAMPLE ST').location);
assert.equal(verify('100 Northwest Example St New Orleans LA 70125','100 NE EXAMPLE ST').location,null);
for(const unit of ['Apt #2','Apt 2','Unit #B','Suite #A-2','#3','Bldg 1']) {
  for(const address of [`100 Example St ${unit} New Orleans LA 70125`,`100 Example St New Orleans LA 70125 ${unit}`]) {
    assert.ok(verify(address).location,`Unit does not obscure premises: ${address}`);
    const display=appointmentServiceAddress({address,mapAddress:match().matchedAddress});
    assert.ok(display.includes(unit),`Source unit survives display: ${display}`);
    assert.ok(!cleanServiceQuery(address).includes(unit),'Provider query omits unit');
  }
}
assert.equal(appointmentServiceAddress({address:'100 Example St Apt #2 New Orleans LA 70125',mapAddress:'100 EXAMPLE ST Apt 20, NEW ORLEANS, LA, 70125'}), '100 EXAMPLE ST, Apt #2, NEW ORLEANS, LA, 70125');
for (const tail of ['B115 New Orleans LA 70125','B115, New Orleans, 70125','AB115C New Orleans LA 70125']) {
  const address=`100 Example St ${tail}`;
  assert.ok(verify(address).location,'Bare alphanumeric unit is not part of the street');
  assert(!cleanServiceQuery(address).includes(tail.split(/[ ,]/)[0]));
  assert(appointmentServiceAddress({address,mapAddress:match().matchedAddress}).includes(`Unit ${tail.split(/[ ,]/)[0]}`),'Crew instructions preserve the unit');
}
for (const input of ['100 County Rd B115 New Orleans LA 70125','100 Parish Road A12 New Orleans LA 70125','100 Example Highway B115 New Orleans LA 70125','100 Example St B115','100 Example St 115 New Orleans LA 70125']) {
  assert.equal(cleanServiceQuery(input),input,'Ambiguous route, incomplete locality and numeric suffix are not inferred units');
}
assert.equal(verify('100 E Example St B115 New Orleans LA 70125').location,null,'Unit repair must not erase a directional conflict');
assert.equal(appointmentServiceAddress({address:'100 Example St B115 New Orleans LA 70125',mapAddress:'100 EXAMPLE ST B210, NEW ORLEANS, LA, 70125'}),'100 EXAMPLE ST, Unit B115, NEW ORLEANS, LA, 70125');

const written=match('100 SIXTH ST','SIXTH'),numeric=match('100 6TH ST','6TH');
assert.ok(verifyCensusAddress('100 Sixth St New Orleans LA 70125',{result:{addressMatches:[written,numeric]}}).location,'Same road, point and premises collapse ordinal aliases');
for(const other of [
  {...numeric,coordinates:{x:-90.10001,y:29.95}},
  {...numeric,tigerLine:{tigerLineId:'different',side:'R'}},
  {...numeric,tigerLine:{tigerLineId:'synthetic-segment',side:'L'}},
  {...numeric,matchedAddress:'101 6TH ST, NEW ORLEANS, LA, 70125'},
  {...numeric,matchedAddress:'100 7TH ST, NEW ORLEANS, LA, 70125'},
  {...numeric,addressComponents:{...numeric.addressComponents,city:'OTHER CITY'}},
]) assert.equal(verifyCensusAddress('100 Sixth St New Orleans LA 70125',{result:{addressMatches:[written,other]}}).location,null,'Competing premises are never collapsed');

const building={lat:'29.95',lon:'-90.1',osm_type:'way',osm_id:12345,place_rank:30,category:'place',type:'house',boundingbox:['29.9499','29.9501','-90.1001','-90.0999'],address:{house_number:'100',road:'Example Street',city:'New Orleans',state:'Louisiana',postcode:'70125',country_code:'us'}};
for(const input of ['100 Example St Other City LA 70125','100 Example St New Orleans MS 70125','98-100 Example St New Orleans LA 70125','100 1/2 Example St New Orleans LA 70125']) assert.equal(verifyOsmServiceAddress(input,[building]).location,null,'Fallback enforces identical source identity guards');
assert.ok(verifyOsmServiceAddress('100AB Example St Apt #2 New Orleans LA 70125',[{...building,address:{...building.address,house_number:'100AB'}}]).location);

const cachePath=(address:string)=>path.join(process.env.SERVICE_ADDRESS_CACHE_DIR!,createHash('sha256').update(address).digest('hex')+'.json');
function seedOld(address:string,matchedAddress?:string) {
  fs.mkdirSync(process.env.SERVICE_ADDRESS_CACHE_DIR!,{recursive:true});
  fs.writeFileSync(cachePath(address),JSON.stringify({schema:7,address,expires:Date.now()+3600000,verified:{location:point,reason:'House, Street, And ZIP Verified',matchedAddress}}));
}
const valid='100 Example St New Orleans LA 70125';
seedOld(valid,match().matchedAddress);
assert.deepEqual(cachedAddressVerification(valid)?.location,point,'Revalidate old evidence locally without discarding valid pins');
for(const bad of ['100 Example St Other City LA 70125','98-100 Example St New Orleans LA 70125','100 1/2 Example St New Orleans LA 70125']) {
  seedOld(bad,match().matchedAddress);
  assert.equal(cachedAddressVerification(bad),undefined,'Old unsafe successes cannot bypass current validation');
  const normalized=bad.toUpperCase(),hash=createHash('sha256').update(normalized).digest('hex');
  assert.equal(planningLocation(bad,{[hash]:{...point,normalized_address:normalized,match_confidence:'confirmed',house_street_verified:true}}),null,'Legacy planning pin cannot bypass current validation');
}
const unknown='100 Legacy St New Orleans LA 70125';seedOld(unknown);
assert.equal(cachedAddressVerification(unknown),undefined,'An old point without matched-address evidence must reverify');

async function retryAfterOutage() {
  const previousFetch=globalThis.fetch,previousNow=Date.now;
  let now=2_000_000_000,censusCalls=0,osmCalls=0,recovered=false;
  Date.now=()=>now;
  const address='100 Recovery St New Orleans LA 70125';
  try {
    globalThis.fetch=async(input)=>{
      if(String(input).includes('census.gov')){censusCalls++;return recovered?new Response(JSON.stringify(fixture('100 RECOVERY ST'))):new Response('temporarily unavailable',{status:503});}
      osmCalls++;return new Response('[]');
    };
    const first=await verifyDesktopAddress(address);
    assert.equal(first.location,null);assert.equal(first.retryAfterMs,60_000);
    assert.equal(censusCalls,1,'An outage does not fan out duplicate query requests');
    assert.equal(osmCalls,1);
    assert.deepEqual(await verifyDesktopAddress(address),first);assert.equal(censusCalls,1,'Backoff is respected');
    now+=60_000;
    recovered=true;
    assert.ok((await verifyDesktopAddress(address)).location,'Recovery rechecks provider after the short cache expires');
    assert.equal(censusCalls,2);
    assert.equal(JSON.parse(fs.readFileSync(cachePath(address),'utf8')).schema,ADDRESS_VERIFICATION_POLICY);
  } finally {globalThis.fetch=previousFetch;Date.now=previousNow;}
}
retryAfterOutage().then(()=>console.log('Address hardening passed: complete house/locality/state, units, ordinals, duplicate aliases, legacy evidence, bounded outage recovery. Synthetic providers only.')).finally(()=>fs.rmSync(root,{recursive:true,force:true})).catch(error=>{console.error(error);process.exitCode=1;});
