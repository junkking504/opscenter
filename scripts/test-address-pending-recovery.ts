import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {cleanServiceQuery,legacyServiceQuery,serviceUnitIdentifiers,normalizeServiceAddress,appointmentServiceAddress} from '../lib/service-address-format';
import {readAddressEvidenceFallback as readAddressMapFallback} from '../lib/address-map-fallback';
import {verifyGeocodioAddress} from '../lib/geocodio-service-address';
import {planningLocation} from '../lib/planning-geocodes';
import {ADDRESS_VERIFICATION_POLICY} from '../lib/desktop-address-verification';
import {addressProviderHealth} from '../lib/address-provider-health';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'address-pending-'));
const before={...process.env},fetchBefore=globalThis.fetch;
const now=Date.now();let calls=0;
globalThis.fetch=async()=>{calls++;throw Error('Network forbidden');};
Object.assign(process.env,{OPSBOT_DATA_DIR:root,OPSCENTER_DATA_DIR:root,GEOCODIO_FREE_STATE_FILE:path.join(root,'ledger.json'),GEOCODIO_FREE_CONFIG_FILE:path.join(root,'config.json')});
const source='45678 Highway 17 C42 Denham Springs, LA 70726';
const direction='321 Example Pl E, Metairie La METAIRIE, LA 70005';
const point={lat:29.98,lng:-90.14};
const row=(street:string,extra={})=>({address_components:{number:'321',formatted_street:street,city:'Metairie',state_province:'LA',postal_code:'70005',country:'US',...extra},location:point,accuracy:1,accuracy_type:'rooftop',match_type:'building_centroid'});
const cache=(address:string,rows:unknown[])=>fs.writeFileSync(process.env.GEOCODIO_FREE_STATE_FILE!,JSON.stringify({schema:1,cache:{[createHash('sha256').update(normalizeServiceAddress(legacyServiceQuery(address))).digest('hex')]:{expires:now+60000,payload:{results:rows}}}}));
try {
  assert.equal(cleanServiceQuery(source),'45678 Highway 17 Denham Springs, LA 70726');
  assert.deepEqual(serviceUnitIdentifiers(source),['C42']);
  assert.equal(legacyServiceQuery(source),source,'Legacy keys remain readable');
  for(const route of ['LA-17','LA Highway 17','US Highway 17','State Route 17','Hwy 17']) {
    const a=source.replace('Highway 17',route);
    assert.deepEqual(serviceUnitIdentifiers(a),['C42']);assert.ok(!cleanServiceQuery(a).includes('C42'));
  }
  for(const a of ['45678 Highway 17A Denham Springs, LA 70726','45678 Highway 17-A Denham Springs, LA 70726','45678 Highway 17 N Denham Springs, LA 70726','45678 Highway C42 Denham Springs, LA 70726','45678 Highway 17 C42','45678 Highway 17 C42 100 Other Rd Denham Springs, LA 70726'])assert.deepEqual(serviceUnitIdentifiers(a),[],a);
  assert.match(appointmentServiceAddress({address:source,mapAddress:'45678 LA Highway 17, Denham Springs, LA 70726'}),/Unit C42/);
  const unitRow={...row('LA Highway 17'),address_components:{number:'45678',formatted_street:'LA Highway 17',city:'Denham Springs',state_province:'LA',postal_code:'70726',country:'US'}};
  cache(source,[unitRow]);assert.deepEqual(readAddressMapFallback(source,now)?.location,{latitude:point.lat,longitude:point.lng});
  assert.match(readAddressMapFallback(source,now)!.detail,/Unit entrance not located/);
  cache(source,[{...unitRow,address_components:{...unitRow.address_components,unit_number:'C43'}}]);assert.equal(readAddressMapFallback(source,now),null);
  cache(direction,[row('E Example Pl'),row('W Example Pl',{unit_number:'E'})]);
  assert.deepEqual(readAddressMapFallback(direction,now)?.location,{latitude:point.lat,longitude:point.lng});
  assert.match(readAddressMapFallback(direction,now)!.detail,/post-direction/);
  assert.equal(verifyGeocodioAddress(direction,{results:[row('E Example Pl')]}).location,null,'Display recovery does not verify relocated direction');
  for(const bad of [row('W Example Pl'),row('Example Pl'),row('E Other Pl'),row('E Example Pl',{number:'322'}),row('E Example Pl',{city:'Kenner'}),row('E Example Pl',{postal_code:'70006'}),row('E Example Pl',{unit_number:'E'}),{...row('E Example Pl'),accuracy_type:'range_interpolation'},{...row('E Example Pl'),accuracy:0.99}]) {
    cache(direction,[bad]);assert.equal(readAddressMapFallback(direction,now),null,JSON.stringify(bad));
  }
  cache(direction,[row('E Example Pl'),{...row('E Example Pl'),location:{lat:30,lng:-90.15}}]);
  assert.equal(readAddressMapFallback(direction,now),null,'Competing directional premises stay unresolved');
  const config={schema:1,enabled:true,provider:'geocodio',maxSpendMicros:0,maxRequests:2500,noPaymentMethod:true,apiKey:'synthetic-secret',verifiedAt:new Date(now-86400000).toISOString(),validUntil:new Date(now+20*86400000).toISOString()};
  const health=(patch={})=>{fs.writeFileSync(process.env.GEOCODIO_FREE_CONFIG_FILE!,JSON.stringify({...config,...patch}));return addressProviderHealth(now);};
  assert.equal(health().tone,'healthy');
  assert.equal(health({validUntil:new Date(now+86400000).toISOString()}).state,'Free account review due soon');
  assert.equal(health({validUntil:new Date(now-1000).toISOString()}).state,'Free account review expired');
  for(const patch of [{maxSpendMicros:1},{noPaymentMethod:false},{maxRequests:2501},{enabled:false},{apiKey:''},{validUntil:'bad'}])assert.equal(health(patch).tone,'warning');
  assert.ok(!JSON.stringify(health()).includes('synthetic-secret'),'Health never exposes credentials');
  fs.writeFileSync(process.env.GEOCODIO_FREE_CONFIG_FILE!,'broken');assert.equal(addressProviderHealth(now).tone,'warning');
  const oldPin={latitude:29.95,longitude:-90.05,normalized_address:'123 EXAMPLE ST, NEW ORLEANS, 70114',
    match_confidence:'confirmed',house_street_verified:true,verification_policy:ADDRESS_VERIFICATION_POLICY-1,
    matched_address:'123 EXAMPLE ST, NEW ORLEANS, LA, 70114'};
  const sourceVariant='Amazon Mattress Removal 123 Example St NEW ORLEANS, LA 70114';
  const geocodes={old:oldPin};
  assert.deepEqual(planningLocation(sourceVariant,geocodes),{latitude:29.95,longitude:-90.05},'Revalidate older successful evidence across business, comma, state and case variants without requests');
  for(const patch of [{matched_address:undefined},{matched_address:'124 EXAMPLE ST, NEW ORLEANS, LA, 70114'},
    {matched_address:'123 OTHER ST, NEW ORLEANS, LA, 70114'},{matched_address:'123 EXAMPLE ST, KENNER, LA, 70114'},
    {verification_policy:0},{verification_policy:ADDRESS_VERIFICATION_POLICY+1},{house_street_verified:false},
    {latitude:0},{match_confidence:'approximate'}])assert.equal(planningLocation(sourceVariant,{old:{...oldPin,...patch}}),null,JSON.stringify(patch));
  assert.equal(planningLocation(sourceVariant,{old:oldPin,conflict:{...oldPin,latitude:29.96}}),null,'Conflicting revalidated points stay unresolved');
  assert.equal(calls,0);
  console.log('Address recovery PASS: highway units, guarded direction relocation, cached evidence, and early free-account expiry warning; no provider requests.');
} finally {process.env=before;globalThis.fetch=fetchBefore;fs.rmSync(root,{recursive:true,force:true});}
