import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {osmAddressJson} from '../lib/osm-address-transport';
import {watchTruckAddress} from '../lib/truck-address-client';

async function main() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'truck-address-'));
  const prior={fetch:globalThis.fetch, now:Date.now, cache:process.env.OSM_ADDRESS_CACHE_DIR, disabled:process.env.OPSCENTER_OSM_ADDRESS_LOOKUPS, setTimeout:globalThis.setTimeout, clearTimeout:globalThis.clearTimeout};
  let now=2_000_001_000, calls=0;
  const params=new URLSearchParams({lat:'30',lon:'-90'});
  try {
    process.env.OSM_ADDRESS_CACHE_DIR=root;
    delete process.env.OPSCENTER_OSM_ADDRESS_LOOKUPS;
    Date.now=()=>now;
    globalThis.fetch=async()=>{calls++;return Response.json({display_name:'100 Example Street, Example City'});};
    assert.deepEqual((await osmAddressJson('reverse',params)).payload,{display_name:'100 Example Street, Example City'});
    now+=86400_000;
    assert.ok((await osmAddressJson('reverse',params)).payload);
    assert.equal(calls,1,'A next-day viewer reuses the durable address without provider traffic');
    now+=31*86400_000+7000;
    const deferred=await osmAddressJson('reverse',params);
    assert.ok(deferred.stale && deferred.payload && deferred.retryAfterMs,'Expired success survives a rate-limit delay');
    now=Math.ceil(now/20_000)*20_000+1000;
    globalThis.fetch=async()=>{calls++;throw Error('provider offline');};
    assert.ok((await osmAddressJson('reverse',params)).stale,'An outage retains the address');
    now+=20_000;
    assert.ok((await osmAddressJson('reverse',params)).payload,'The failed refresh did not erase the durable success');

    let pending:(()=>void)|undefined, delay=0, clientCalls=0;
    globalThis.setTimeout=((callback:()=>void,ms:number)=>{pending=callback;delay=ms;return 1;}) as unknown as typeof setTimeout;
    globalThis.clearTimeout=(()=>{pending=undefined;}) as typeof clearTimeout;
    globalThis.fetch=async()=>{clientCalls++;return Response.json(clientCalls===1?{address:null,retryAfterMs:17100}:{address:'Example Avenue'});};
    const updates:string[]=[];
    const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
    const stop=watchTruckAddress(30.12345,-90.54321,result=>updates.push(result.address));
    await flush();
    assert.equal(delay,17100,'The client respects admission delay');
    assert.equal(updates.length,0,'Pending lookup never emits an empty address');
    const retry=pending!;pending=undefined;retry();await flush();
    assert.deepEqual(updates,['Example Avenue']);
    assert.equal(pending,undefined,'Successful lookup stops retrying');
    stop();
    globalThis.fetch=async()=>{throw Error('offline');};
    const stopAgain=watchTruckAddress(30.12345,-90.54321,result=>updates.push(result.address));
    await flush();
    assert.equal(updates.at(-1),'Example Avenue','Reopening retains the coordinate address through a network failure');
    assert.equal(delay,60_000);
    stopAgain();assert.equal(pending,undefined,'Closing the card cancels retries');
    let complete!:(value:Response)=>void;
    globalThis.fetch=()=>new Promise(resolve=>{complete=resolve;});
    const stopLate=watchTruckAddress(31,-91,()=>assert.fail('A canceled request must not update another truck'));
    stopLate();complete(Response.json({address:'Late address'}));await flush();
    console.log('Truck address tests passed: durable cache, limiter/outage recovery, automatic retries, retention and cancellation.');
  } finally {
    globalThis.fetch=prior.fetch;Date.now=prior.now;globalThis.setTimeout=prior.setTimeout;globalThis.clearTimeout=prior.clearTimeout;
    for(const [key,value] of Object.entries({OSM_ADDRESS_CACHE_DIR:prior.cache,OPSCENTER_OSM_ADDRESS_LOOKUPS:prior.disabled}))if(value===undefined)delete process.env[key];else process.env[key]=value;
    fs.rmSync(root,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
