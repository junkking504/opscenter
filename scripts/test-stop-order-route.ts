import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as order from '../lib/schedule-stop-order';

// Execute the actual route with every boundary mocked; never touch live data,
// authentication, geocoding, routing or the order store.
const jobs = [1,2,3,4].map(id=>({recordId:`2026-09-09:appointment:${id}`,appointmentId:String(id),version:'1',address:'100 Example St New Orleans LA 70125',status:'Confirmed',truck:'Truck 8',appointmentStartMinutes:480,appointmentEndMinutes:540,hasScheduledTime:true}));
let snapshot = {date:'2026-09-09',appointments:jobs};
let lookups = 0;
let saves = 0;
class StopOrderConflict extends Error {}
const dependencies: Record<string, unknown> = {
  'next/headers': {cookies:async()=>({get:()=>({value:'synthetic'})})},
  '@/lib/auth': {AUTH_SESSION_COOKIE:'test',verifyAuthSessionCookie:async()=>({email:'test',role:'manager'})},
  '@/lib/desktop-request-origin': {isDesktopWriteOriginAllowed:()=>true},
  '@/lib/ops-roles': {opsRoleCan:()=>true},
  '@/lib/schedule-stop-order': order,
  '@/lib/desktop-schedule': {
    readDesktopSchedule:()=>snapshot,
    readVerifiedDesktopSchedule:async()=>{lookups++;throw new Error('Address verification unavailable');},
    calculateDesktopRouteLegs:()=>{throw new Error('Unexpected road lookup');},
  },
  '@/lib/desktop-stop-order': {nearestStopOrder:()=>{throw new Error('Unexpected nearest lookup');}},
  '@/lib/desktop-stop-order-store': {
    StopOrderConflict,
    saveStopOrder:(input:{ids:string[]},reread:()=>typeof jobs)=>{
      assert.equal(reread(),snapshot.appointments,'Preserve locked source reread');
      saves++;
      snapshot = {...snapshot,appointments:input.ids.map(id=>jobs.find(job=>job.recordId===id)!)};
    },
  },
};
const compiled = ts.transpileModule(fs.readFileSync(new URL('../app/api/desktop/schedule/order/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleExports: {POST?:(request:Request)=>Promise<Response>} = {};
new Function('require','exports',compiled)((name:string)=>{
  assert(name in dependencies,`Unexpected dependency: ${name}`);
  return dependencies[name];
},moduleExports);
const group = order.stopGroups(jobs)[0];
const input = {date:snapshot.date,action:'save',groupKey:order.stopGroupKey(group[0]),sourceKey:order.stopOrderSourceKey(group),ids:group.map(job=>job.recordId).reverse()};
const post = (body:unknown)=>moduleExports.POST!(new Request('https://example.test/api/desktop/schedule/order',{method:'POST',body:JSON.stringify(body)}));
async function main() {
  const saved = await post(input);
  assert.equal(saved.status,200);
  assert.deepEqual((await saved.json()).snapshot.appointments.map((job:{recordId:string})=>job.recordId),input.ids);
  assert.equal(saves,1);
  assert.equal(lookups,0,'Save must not wait on external address verification');
  const stale = await post({...input,sourceKey:'stale'});
  assert.equal(stale.status,409,'Local save still rejects stale source');
  const invalid = await post({...input,ids:[input.ids[0],input.ids[0]]});
  assert.equal(invalid.status,400,'Local save still rejects incomplete/duplicate stops');
  assert.equal(saves,1,'Invalid saves never reach persistence');
  const preview = await post({...input,action:'preview'});
  assert.equal(preview.status,400);
  assert.equal(lookups,1,'Travel preview retains verified-address boundary');
  console.log('Stop order route passed: no external lookup on save, snapshot read-back, source conflict and permutation checks. Synthetic dependencies only.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
