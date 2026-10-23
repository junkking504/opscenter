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
  // A timer may fire before the wall-clock deadline (or the clock may move
  // backwards). Once it fires, no later batch or fallback may start.
  Date.now=()=>started;
  let partial;
  try {
    partial=await osmTravelMatrix(origins,[destination],async()=>{
      reads++;return reads===1 ? table : new Promise(resolve=>{resolveLate=resolve;});
    },30);
  } finally {Date.now=actualNow;}
  assert.equal(reads,2);assert.equal(partial?.length,5,'Preserve completed batches when another stalls');
  assert.ok(Date.now()-started<1000,'Queue/provider stall has a bounded total wait');
  resolveLate(table);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(partial?.length,5,'Late responses cannot mutate a published partial result');
  assert.deepEqual(await osmTravelMatrix(origins,[destination],async()=>new Promise(()=>{}),10),[],'No completed routes stays unavailable');
  assert.deepEqual(await osmTravelMatrix([origin],[destination],async()=>{throw Error('Synthetic failure');},10),[]);
  let fallbackCalls=0;
  const recovered=await osmTravelMatrix(origins.slice(0,2),[destination],async path=>{
    fallbackCalls++;
    return path.startsWith('table/') ? {code:'NoSegment'} : {code:'Ok',routes:[{duration:600,distance:5000}],waypoints:[{distance:0},{distance:0}]};
  });
  const paths:string[]=[];
  const later=await osmTravelMatrix(origins,[destination],async path=>{
    paths.push(path);
    return paths.length===1 ? {code:'NoSegment'} : path.startsWith('table/') ? table : {code:'Ok',routes:[{duration:600,distance:5000}],waypoints:[{distance:0},{distance:0}]};
  });
  assert.ok(paths.slice(0,3).every(path=>path.startsWith('table/')),'Later tables precede fallback requests');
  assert.equal(later?.length,11,'Failed first batch does not starve later tables');
  assert.equal(fallbackCalls,3);assert.equal(recovered?.length,2);
  assert.deepEqual(recovered?.map(row=>row.originIndex),[0,1]);
  console.log('PASS routing deadline: serial-batch timeout reproduced, bounded partial results, no late mutation, failure stays unavailable; all providers mocked.');
}
void main();
