import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyDesktopAddress, cachedAddressVerification} from '../lib/desktop-address-verification';
import {readAddressMapFallback} from '../lib/address-map-fallback';
import {verifyGeocodioAddress} from '../lib/geocodio-service-address';

async function main() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'address-map-refresh-'));
  const envKeys=['GEOCODIO_FREE_CONFIG_FILE','GEOCODIO_FREE_STATE_FILE','OPSBOT_DATA_DIR','OPSCENTER_DATA_DIR','SERVICE_ADDRESS_CACHE_DIR','OSM_ADDRESS_CACHE_DIR'];
  const previous=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
  const originalFetch=globalThis.fetch,originalNow=Date.now;
  let now=1_800_000_000_000,calls=0;
  Date.now=()=>now;
  process.env.OPSBOT_DATA_DIR=root; process.env.OPSCENTER_DATA_DIR=root;
  process.env.SERVICE_ADDRESS_CACHE_DIR=path.join(root,'verified');
  process.env.OSM_ADDRESS_CACHE_DIR=path.join(root,'osm');
  process.env.GEOCODIO_FREE_CONFIG_FILE=path.join(root,'config.json');
  process.env.GEOCODIO_FREE_STATE_FILE=path.join(root,'ledger.json');
  fs.writeFileSync(process.env.GEOCODIO_FREE_CONFIG_FILE,JSON.stringify({schema:1,enabled:true,provider:'geocodio',maxSpendMicros:0,maxRequests:2,noPaymentMethod:true,verifiedAt:new Date(now-1000).toISOString(),validUntil:new Date(now+30*86400000).toISOString(),apiKey:'synthetic-test-key'}));
  fs.writeFileSync(process.env.GEOCODIO_FREE_STATE_FILE,JSON.stringify({schema:1,lastAt:0,attempts:[],blockedUntil:0,cache:{}}));
  const source='110A Example Cr, Slidell, 70458';
  const payload={results:[{address_components:{number:'110A',formatted_street:'Example Cir',city:'Slidell',state_province:'LA',postal_code:'70458',country:'US'},location:{lat:30.22,lng:-89.82},accuracy:1,accuracy_type:'rooftop',match_type:'building_centroid'}]};
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    if(url.hostname==='api.geocod.io') {calls++;assert.match(url.searchParams.get('q')!,/110A Example Cir/);return Response.json(payload);}
    if(url.hostname==='nominatim.openstreetmap.org')return Response.json([]);
    if(url.hostname==='maps.stpgov.org')return Response.json({spatialReference:{wkid:4326},features:[]});
    assert.equal(url.hostname,'geocoding.geo.census.gov');return Response.json({result:{addressMatches:[]}});
  };
  try {
    assert.ok(verifyGeocodioAddress(source.replace(' Cr,',' Cir,'),payload).location,'Provider can verify interpreted query');
    assert.equal(readAddressMapFallback(source),null);
    assert.equal((await verifyDesktopAddress(source)).location,null,'Interpreted query cannot verify original source');
    assert.equal(calls,1);
    assert.ok(readAddressMapFallback(source)?.location,'Automatic worker populates map cache');
    assert.equal(cachedAddressVerification(source)?.location,null);
    await verifyDesktopAddress(source);assert.equal(calls,1,'Verification cache avoids repeated requests');
    now+=10*60_000;
    await verifyDesktopAddress(source);assert.equal(calls,1,'Provider cache survives verification retries');
    now+=15*86400_000;
    assert.equal(readAddressMapFallback(source),null,'Evidence exceeds cache and stale-display lifetime');
    payload.results[0].address_components.number='110';
    assert.equal((await verifyDesktopAddress(source)).location,null);
    assert.equal(calls,2,'Expired evidence automatically refreshes through bounded free lookup');
    assert.match(readAddressMapFallback(source)!.detail,/suffix A is unconfirmed/);
    assert.equal(cachedAddressVerification(source)?.location,null,'Base building also remains display-only');
    console.log('Address shorthand automatically refreshes expired map evidence; original exact verification remains separate. All providers mocked.');
  } finally {
    globalThis.fetch=originalFetch;Date.now=originalNow;
    for(const key of envKeys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
    fs.rmSync(root,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
