import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {approximateMapAddressQuery} from '../lib/address-map-query';
import {osmMapAddressQuery,osmServiceAddressQuery,verifyOsmAddressFallback,verifyOsmServiceAddress} from '../lib/osm-service-address';
import {readAddressMapFallback} from '../lib/address-map-fallback';

const source='110A Northshore Cr, Slidell, 70458';
assert.equal(approximateMapAddressQuery(source),'110A Northshore Cir, Slidell, 70458');
assert.equal(osmServiceAddressQuery(source),null,'Exact-property parsing must not silently reinterpret the suffix');
assert.equal(osmMapAddressQuery(source),'110A Northshore Cir, Slidell');
for(const unchanged of ['110A CR 123, Slidell, 70458','110A Northshore Cr','110A Northshore Circle, Slidell, 70458','110A Northshore Cr or 120 Other St, Slidell, 70458']) {
  assert.equal(approximateMapAddressQuery(unchanged),unchanged);
}
const row={osm_type:'way',osm_id:123,lat:'30.28',lon:'-89.79',category:'building',type:'house',place_rank:30,boundingbox:['30.2798','30.2802','-89.7902','-89.7898'],address:{house_number:'110A',road:'Northshore Circle',city:'Slidell',state:'Louisiana','ISO3166-2-lvl4':'US-LA',postcode:'70458',country_code:'us'}};
assert.equal(verifyOsmServiceAddress(source,[row]).location,null,'A guessed suffix cannot confirm a premises');
async function main() {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'map-query-'));
 const before={env:{...process.env},fetch:globalThis.fetch,now:Date.now};
 let calls=0;
 try {
  process.env.OPSCENTER_DATA_DIR=root;process.env.OPSBOT_DATA_DIR=root;process.env.OSM_ADDRESS_CACHE_DIR=path.join(root,'osm');process.env.GEOCODIO_FREE_STATE_FILE=path.join(root,'geocodio.json');
  Date.now=()=>1_800_000_000_000;
  globalThis.fetch=async input=>{calls++;const url=new URL(String(input));assert.equal(url.hostname,'nominatim.openstreetmap.org');assert.equal(url.searchParams.get('q'),'110A Northshore Cir, Slidell');return new Response(JSON.stringify([row]));};
  assert.equal((await verifyOsmAddressFallback(source)).location,null);
  assert.equal(calls,1,'Use the existing bounded free lookup, not an additional provider path');
  const pin=readAddressMapFallback(source)!;
  assert.deepEqual(pin.location,{latitude:30.28,longitude:-89.79});
  assert.match(pin.matchedAddress,/110A Northshore Circle/,'Preserve the alphanumeric house number');
  assert.equal(readAddressMapFallback(source.replace('110A','110B')),null,'Do not substitute a different house identifier');
  await verifyOsmAddressFallback(source);
  assert.equal(calls,1,'Repeated checks reuse the existing evidence cache');
  assert.equal(source,'110A Northshore Cr, Slidell, 70458','Source text remains unchanged');
  console.log('Approximate map query passed: trailing Cr recovery, house/county-road preservation, original-source verification, shared cache and no extra provider call.');
 } finally {process.env=before.env;globalThis.fetch=before.fetch;Date.now=before.now;fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

assert.equal(osmServiceAddressQuery('105 Example Trace, Covington, 70435'),'105 Example Trace, Covington','Trace is a street type and must reach the free provider');
assert.equal(osmServiceAddressQuery('105 Example Trce, Covington, 70435'),'105 Example Trce, Covington');
