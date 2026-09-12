import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { osmServiceAddressQuery,verifyOsmServiceAddress } from '../lib/osm-service-address';
import { osmAddressJson } from '../lib/osm-address-transport';
import { verifyDesktopAddress } from '../lib/desktop-address-verification';

// Synthetic property: exact building, with a conflicting source postal code.
const original='100 Example Dr Baton Rouge, LA 70810';
const building={lat:'30.4181',lon:'-91.1466',osm_type:'way',osm_id:12345,place_rank:30,category:'place',type:'house',boundingbox:['30.4180','30.4182','-91.1467','-91.1465'],address:{house_number:'100',road:'Example Drive',city:'Baton Rouge',state:'Louisiana',postcode:'70808',country_code:'us'}};
const verified=verifyOsmServiceAddress(original,[building]);
assert.ok(verified.location);
assert.match(verified.reason,/Source ZIP Differs/);
assert.equal(verified.matchedAddress,'100 Example Drive, Baton Rouge, LA 70808');
assert.ok(verifyOsmServiceAddress(original.replace('70810','70808'),[building]).location);
assert.ok(verifyOsmServiceAddress(original.replace('Dr','Dr Apt R'),[building]).location);
assert.equal(osmServiceAddressQuery('Customer Company 100 Example Dr Apt R Baton Rouge, LA 70810'),'100 Example Dr Baton Rouge, LA');
for(const bad of [
  {...building,address:{...building.address,house_number:'101'}},
  {...building,address:{...building.address,road:'Example Road'}},
  {...building,address:{...building.address,road:'N Example Drive'}},
  {...building,address:{...building.address,city:'Other City'}},
  {...building,address:{...building.address,state:'Mississippi'}},
  {...building,address:{...building.address,postcode:'70125'}},
  {...building,address:{...building.address,house_number:undefined}},
  {...building,place_rank:26},
  {...building,category:'highway',type:'residential'},
  {...building,lat:'',lon:''},
  {...building,lat:'0',lon:'0'},
  {...building,boundingbox:['30','31','-92','-90']},
  {...building,boundingbox:undefined},
  {...building,osm_id:undefined},
  null,
]) assert.equal(verifyOsmServiceAddress(original,[bad]).location,null,JSON.stringify(bad));
assert.equal(verifyOsmServiceAddress(original,[building,{...building,osm_id:2}]).location,null,'Do not discard alternative objects');
assert.equal(verifyOsmServiceAddress(original.replace('LA','MS'),[building]).location,null);
assert.equal(verifyOsmServiceAddress('100 Example Dr Baton Rouge LA 70810 or 200 Elsewhere St Baton Rouge LA 70810',[building]).location,null);
assert.equal(osmServiceAddressQuery('Missing service address'),null);

async function main() {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'osm-address-test-'));
  const previous={cache:process.env.OSM_ADDRESS_CACHE_DIR,service:process.env.SERVICE_ADDRESS_CACHE_DIR,disabled:process.env.OPSCENTER_OSM_ADDRESS_LOOKUPS,fetch:globalThis.fetch,now:Date.now};
  let now=2_000_001_000,calls=0;
  try {
    process.env.OSM_ADDRESS_CACHE_DIR=temp;process.env.SERVICE_ADDRESS_CACHE_DIR=path.join(temp,'service');
    delete process.env.OPSCENTER_OSM_ADDRESS_LOOKUPS;
    Date.now=()=>now;
    globalThis.fetch=async(input)=>{calls++;assert.match(String(input),/nominatim\.openstreetmap\.org/);return new Response(JSON.stringify([building]));};
    const results=await Promise.all(Array.from({length:8},(_,i)=>osmAddressJson('search',new URLSearchParams({q:`query ${i}`}))));
    assert.equal(calls,1,'Concurrent callers share a disk reservation');
    assert.equal(results.filter(row=>row.retryAfterMs).length,7);
    await osmAddressJson('search',new URLSearchParams({q:'query 0'}));assert.equal(calls,1,'Disk cache bypasses provider entirely');
    now+=7000;
    assert.ok((await osmAddressJson('reverse',new URLSearchParams({lat:'30',lon:'-90'}))).retryAfterMs,'Reverse and forward share the same limiter');
    now=2_000_021_000;
    await osmAddressJson('search',new URLSearchParams({q:'query new'}));assert.equal(calls,2,'Next reservation remains available after prior completion/crash');
    process.env.OPSCENTER_OSM_ADDRESS_LOOKUPS='off';
    assert.ok((await osmAddressJson('search',new URLSearchParams({q:'disabled'}))).retryAfterMs);assert.equal(calls,2);
    delete process.env.OPSCENTER_OSM_ADDRESS_LOOKUPS;
    now=2_000_041_000;
    let censusCalls=0,osmCalls=0;
    globalThis.fetch=async(input)=>{
      if(String(input).includes('census.gov')){censusCalls++;return new Response(JSON.stringify({result:{addressMatches:[]}}));}
      osmCalls++;return new Response(JSON.stringify([building]));
    };
    const result=await verifyDesktopAddress(original);
    assert.ok(result.location,'Automatic Census miss falls through to a verified building without user input');
    assert.equal(result.source,'OpenStreetMap');assert.ok(censusCalls>0);assert.equal(osmCalls,1);
    assert.deepEqual(await verifyDesktopAddress(original),result);assert.equal(osmCalls,1);
  } finally {
    Date.now=previous.now;globalThis.fetch=previous.fetch;
    for(const [key,value] of Object.entries({OSM_ADDRESS_CACHE_DIR:previous.cache,SERVICE_ADDRESS_CACHE_DIR:previous.service,OPSCENTER_OSM_ADDRESS_LOOKUPS:previous.disabled}))if(value===undefined)delete process.env[key];else process.env[key]=value;
    fs.rmSync(temp,{recursive:true,force:true});
  }
  console.log('OSM fallback passed: exact building and postal correction, locality/precision/ambiguity guards, automatic fallback, durable caching, shared rate limit and off switch.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
