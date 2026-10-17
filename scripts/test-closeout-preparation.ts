import assert from 'node:assert/strict';
import {createCloseoutPreparation} from '../desktop-ui/lib/closeout-preparation';

async function main(){
  let reads=0,clock=0;
  const prep=createCloseoutPreparation(async()=>++reads,()=>clock,60_000);
  prep.prepare();prep.prepare();
  assert.equal(await prep.take(),1,'Opening joins the pending preparation');
  assert.equal(reads,1);
  assert.equal(await prep.take(),2,'A consumed payload is never reused for reload');
  prep.prepare();assert.equal(reads,2,'Opening before the timer prevents another speculative read');

  const expiring=createCloseoutPreparation(async()=>++reads,()=>clock,60_000);
  expiring.prepare();await new Promise(resolve=>setImmediate(resolve));
  clock=60_000;
  assert.equal(await expiring.take(),4,'An expired form is read again');

  let failures=0;
  const retry=createCloseoutPreparation(async()=>{if(++failures===1)throw new Error('offline');return 'recovered';});
  retry.prepare();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(failures,1,'No automatic failure retries');
  assert.equal(await retry.take(),'recovered','A speculative failure permits an explicit retry');

  let resolveRead!:(value:string)=>void;
  let signal!:AbortSignal;
  const pending=createCloseoutPreparation(s=>{signal=s;return new Promise<string>(resolve=>{resolveRead=resolve;});});
  pending.prepare();const result=pending.take();await Promise.resolve();
  pending.clear();assert.equal(signal.aborted,true);
  resolveRead('old appointment');
  await assert.rejects(result,{name:'AbortError'},'Late results cannot survive invalidation');

  const first=createCloseoutPreparation(async()=>'appointment A');
  const second=createCloseoutPreparation(async()=>'appointment B');
  first.prepare();second.prepare();first.clear();
  assert.equal(await second.take(),'appointment B','Drawers have independent caches and cancellation');
  console.log('Closeout preparation: single-flight, one-use, expiry, failure retry, cancellation and isolation passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
