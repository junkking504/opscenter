import assert from 'node:assert/strict';
import {osmTravelMatrix} from '../lib/osm-travel-matrix';

const origin={latitude:30,longitude:-90},destination={latitude:30.01,longitude:-90.01};
const origins=Array.from({length:11},(_,i)=>({...origin,longitude:origin.longitude+i/1000}));
const table={code:'Ok',durations:Array.from({length:5},()=>[600]),distances:Array.from({length:5},()=>[5000]),sources:Array.from({length:5},()=>({distance:0})),destinations:[{distance:0}]};
async function main() {
  // Three individually valid 15s table calls previously took 45s in series,
  // colliding with the browser timeout and discarding already completed rows.
  const actualNow=Date.now;let now=actualNow(),calls=0;
  Date.now=()=>now;
  try {
    const result=await osmTravelMatrix(origins,[destination],async()=>{calls++;now+=15_000;return table;});
    assert.equal(calls,2,'Do not start a third batch after the overall deadline');
    assert.equal(result?.length,10,'Return completed road estimates before the browser timeout');
  } finally {Date.now=actualNow;}
  let resolveLate:(value:unknown)=>void=()=>{},reads=0;
  const started=Date.now();
  const partial=await osmTravelMatrix(origins,[destination],async()=>{
    reads++;return reads===1 ? table : new Promise(resolve=>{resolveLate=resolve;});
  },30);
  assert.equal(reads,2);assert.equal(partial?.length,5,'Preserve completed batches when another stalls');
  assert.ok(Date.now()-started<1000,'Queue/provider stall has a bounded total wait');
  resolveLate(table);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(partial?.length,5,'Late responses cannot mutate a published partial result');
  assert.deepEqual(await osmTravelMatrix(origins,[destination],async()=>new Promise(()=>{}),10),[],'No completed routes stays unavailable');
  assert.deepEqual(await osmTravelMatrix([origin],[destination],async()=>{throw Error('Synthetic failure');},10),[]);
  console.log('PASS routing deadline: serial-batch timeout reproduced, bounded partial results, no late mutation, failure stays unavailable; all providers mocked.');
}
void main();
