import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readAddressEvidenceFallback as readAddressMapFallback} from '../lib/address-map-fallback';
import {geocodioAddressQuery,verifyGeocodioAddress} from '../lib/geocodio-service-address';
import {normalizeServiceAddress} from '../lib/service-address-format';
import {appointmentVisitPin} from '../lib/appointment-visit-pin';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'street-center-'));
const old={...process.env};const now=Date.now();
process.env.OPSBOT_DATA_DIR=root;process.env.OPSCENTER_DATA_DIR=root;
process.env.GEOCODIO_FREE_STATE_FILE=path.join(root,'geocodio.json');
const address='100 Example Dr Testville, LA 70726';
const center={address_components:{formatted_street:'Example Dr',city:'Testville',state_province:'LA',postal_code:'70726',country:'US'},location:{lat:30.41,lng:-90.94},accuracy:0.7,accuracy_type:'street_center'};
const key=createHash('sha256').update(normalizeServiceAddress(geocodioAddressQuery(address)!)).digest('hex');
const save=(results:unknown[],expires=now+60000)=>fs.writeFileSync(process.env.GEOCODIO_FREE_STATE_FILE!,JSON.stringify({schema:1,cache:{[key]:{expires,payload:{results}}}}));
try {
  const unrelated={...center,accuracy:0.53,address_components:{...center.address_components,formatted_street:'Other Ln'}};
  save([center,unrelated]);const pin=readAddressMapFallback(address,now)!;
  assert.ok(pin);assert.equal(pin.matchedAddress,'Example Dr, Testville, LA 70726');
  assert.match(pin.detail,/street center; house number not located/);assert.equal(pin.visitEligible,false);
  assert.equal(verifyGeocodioAddress(address,{results:[center,unrelated]}).location,null);
  assert.deepEqual(appointmentVisitPin({location:null,mapFallback:pin})?.location,pin.location);
  save([unrelated,center]);assert.deepEqual(readAddressMapFallback(address,now),pin,'Provider order does not choose the street');
  save([center,center]);assert.ok(readAddressMapFallback(address,now),'Identical duplicates are one center');
  save([center,{...center,location:{lat:30.42,lng:-90.94}}]);assert.equal(readAddressMapFallback(address,now),null);
  for(const patch of [{formatted_street:'Example Ln'},{formatted_street:'N Example Dr'},{city:'Elsewhere'},{postal_code:'70727'},{state_province:'MS'},{country:'CA'}]) {
    save([{...center,address_components:{...center.address_components,...patch}}]);assert.equal(readAddressMapFallback(address,now),null);
  }
  for(const patch of [{accuracy:0.69},{accuracy_type:'place'},{location:{lat:0,lng:0}}]) {
    save([{...center,...patch}]);assert.equal(readAddressMapFallback(address,now),null);
  }
  save([center],now-1);assert.equal(readAddressMapFallback(address,now),null);
  console.log('Exact street centers: matching identity only, labeled approximation, ambiguity/expiry/precision guards, no premises promotion; shared operational coordinate.');
} finally {process.env=old;fs.rmSync(root,{recursive:true,force:true});}
