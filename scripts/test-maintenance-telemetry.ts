import assert from 'node:assert/strict';
import { installMaintenanceTelemetry } from '../desktop-ui/lib/maintenance-telemetry';
const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
const oldNow=Date.now;
let time=1_800_000_000_000;
const reports:Record<string,unknown>[]=[];
const listeners=new Map<string,(event:unknown)=>void>();
let mode='failure';
const fake={location:{href:'https://fixture.test/desktop',origin:'https://fixture.test'},addEventListener:(name:string,handler:(event:unknown)=>void)=>listeners.set(name,handler),fetch:async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
 if(String(input)==='/api/desktop/maintenance'){reports.push(JSON.parse(String(init?.body)));return new Response(null,{status:204});}
 if(mode==='timeout')throw new DOMException('private','TimeoutError');
 if(mode==='cancel')throw new DOMException('private','AbortError');
 if(mode==='invalid')return Response.json({private:'source fields missing'});
 return new Response(null,{status:503});
}};
async function main(){
 try{
  Object.defineProperty(globalThis,'window',{value:fake,configurable:true});Date.now=()=>time;
  installMaintenanceTelemetry();
  await fake.fetch('/api/desktop/schedule/closeout?customer=private',{method:'POST',body:'private'});
  assert.deepEqual(reports[0],{category:'schedule-closeout',method:'POST',failure:'http',status:503});
  await fake.fetch('/api/desktop/schedule/closeout');assert.equal(reports.length,1,'repeat reports are throttled');
  mode='timeout';await fake.fetch('/api/desktop/fleet').catch(()=>{});assert.equal(reports.at(-1)?.failure,'timeout');
  mode='cancel';await fake.fetch('/api/desktop/finance').catch(()=>{});assert.equal(reports.length,2,'explicit cancellation is excluded');
  mode='failure';await fake.fetch('https://fixture-other.test/api/desktop/command');assert.equal(reports.length,2,'external URLs are excluded');
  mode='invalid';await fake.fetch('/api/desktop/command');await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(reports.at(-1)?.failure,'invalid-response');
  time+=61_000;listeners.get('error')?.({message:'private',filename:'private'});
  assert.deepEqual(reports.at(-1),{category:'javascript',failure:'runtime'});
  assert(!JSON.stringify(reports).includes('private'));
  console.log('Browser telemetry passed: distinct write operations, throttling, timeouts, cancellation, contract failures, same-origin scope, and privacy. No network calls.');
 }finally{Date.now=oldNow;if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
