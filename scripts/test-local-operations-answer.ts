import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { performance } from 'node:perf_hooks';
import { buildLocalOperationsAnswer, validLookupDate, type LocalLookupReaders } from '../lib/local-operations-answer';
import { opsRoleCan, type InteractiveOpsRole } from '../lib/ops-roles';
const now = Date.parse('2026-10-02T17:00:00Z');
let metricReads=0,jobReads=0,correctionReads=0,sales=120;
const row={name:'Alex Example',truck:'Truck# 3',clock_in:'07:00 AM',clock_out:'05:00 PM',hours_worked:10,hourly_rate:16,hourly_pay:160,tip:5,total_bonus:0,total_pay:165,pay_is_final:true};
const readers:LocalLookupReaders={
 now:()=>now,
 metrics:date=>{metricReads++;return {generated_at:'2026-10-02T16:00:00Z',payroll_as_of:'2026-10-02T16:00:00Z',sales,
  payroll_records:[{...row,hours_worked:date==='2026-09-25'?5:10}, {name:'Scheduled Only',clock_in:'—',hours_worked:0,tip:10}],
  jobs_by_truck:{'Truck# 3':2},miles_by_truck:{'Truck# 3':12},employees_by_truck:{'Truck# 3':['Alex Example']}};},
 corrected:source=>{correctionReads++;return source;},
 callin:()=>[{name:'Alex Example',status:'Recommended',note:'driver',updatedAt:'2026-10-02T16:00:00Z'}],
 jobs:()=>{jobReads++;return [{appointmentId:'test-1',jkNumber:'JK100',appointmentTime:'8:00 AM',territory:'Test territory',appointmentType:'Job',status:'Confirmed',truck:'Truck# 3',customerName:'DO NOT EXPOSE',phone:'DO NOT EXPOSE',address:'DO NOT EXPOSE'}] as ReturnType<LocalLookupReaders['jobs']>;},
 scheduleAt:()=> '2026-10-02T16:00:00Z',
};
const ask=(q:string,date='2026-10-02',role:InteractiveOpsRole='manager')=>buildLocalOperationsAnswer(q,date,role,readers);
assert(!validLookupDate('2026-02-30'));assert(!validLookupDate('invalid'));assert(validLookupDate('2026-09-21'));
assert.equal(ask('Who was on today?','2026-10-02','operator'),null);assert.equal(metricReads,0);
assert.equal(ask('Why did sales fall?'),null);assert.equal(metricReads,0);
assert.match(ask('Who should I call in tomorrow?')!.answer,/Recommended or Called is not confirmed availability/);
assert.equal(ask('Call in Alex tomorrow'),null);
assert.match(buildLocalOperationsAnswer('Show call-in plan tomorrow','2026-10-02','manager',{...readers,callin:()=>[]})!.answer,/No saved call-in decisions/);
assert.equal(ask('What was Alex attributed revenue?'),null);
assert.equal(ask('What was profit last week?'),null);
assert.equal(ask('What is revenue for September?'),null);
assert.equal(ask('Show jobs 2026-02-30'),null);
assert.equal(ask('Show jobs today and tomorrow'),null);
assert.equal(ask('Compare jobs and pay'),null);
assert.equal(ask('Who worked today? 2026-09-21'),null);
const crew=ask('Who was on today?')!;
assert.match(crew.answer,/Alex Example/);assert(!crew.answer.includes('Scheduled Only'));
assert.match(crew.answer,/Partial operating day/);assert.match(crew.answer,/stale for live use/);
assert.equal(metricReads,1);assert.equal(correctionReads,1);assert.equal(jobReads,0);
const jobs=ask('What jobs are booked tomorrow?')!;
assert.match(jobs.answer,/2026-10-03/);assert.match(jobs.answer,/Future schedule/);
assert(!JSON.stringify(jobs).includes('DO NOT EXPOSE'));assert.equal(metricReads,1);assert.equal(jobReads,1);
const pay=ask('How much did Alex make this week?','2026-09-25')!;
assert.match(pay.answer,/45 hours/);assert.match(pay.answer,/40 regular \/ 5 overtime/);
assert.match(pay.answer,/\$120.00 overtime/);assert.match(pay.answer,/\$785.00 observed gross/);
assert.equal(metricReads,6,'Five daily reads, including selected day reused within this request');
assert.match(ask('How much did Alex make today?')!.answer,/\$165.00/);
assert.match(ask('What is sales today?')!.answer,/\$120.00/);
sales=140;assert.match(ask('What is sales today?')!.answer,/\$140.00/,'Next request must read changed source');
assert.match(ask('Show truck 3 daily performance')!.answer,/12 miles/);
assert(!ask('Show truck 9 daily performance')!.answer.includes('Alex Example'));
const missing={...readers,metrics:()=>null,jobs:()=>[],scheduleAt:()=>null};
assert.match(buildLocalOperationsAnswer('What jobs are booked today?','2026-10-02','manager',missing)!.answer,/zero bookings cannot be established/);
assert.match(buildLocalOperationsAnswer('Who was on today?','2026-10-02','manager',missing)!.answer,/missing/);
assert.match(buildLocalOperationsAnswer('How much did Alex make today?','2026-10-02','manager',{...readers,metrics:()=>({payroll_records:[row,{...row,name:'Alex Other'}]})})!.answer,/unambiguously/);
assert.match(buildLocalOperationsAnswer('Who was on today?','2026-10-02','manager',{...readers,metrics:()=>({payroll_records:[row]})})!.answer,/timestamp unavailable/);

// Exercise actual route handlers with injected auth/source/provider dependencies.
let signedIn=true,role:InteractiveOpsRole='manager',localReads=0,providerReads=0,reserves=0,failSource=false;
const localModule={validLookupDate,buildLocalOperationsAnswer:(q:string,d:string,r:InteractiveOpsRole)=>{localReads++;if(failSource)throw Error('fixture');return buildLocalOperationsAnswer(q,d,r,readers);}};
const dependencies:Record<string,unknown>={
 'node:crypto':{createHash:()=>{throw Error('Local route must not hash/reserve');}},
 'next/headers':{cookies:async()=>({get:()=>({value:'synthetic'})})},
 '@/lib/auth':{AUTH_SESSION_COOKIE:'fixture',verifyAuthSessionCookie:async()=>signedIn?{email:'fixture',role}:null,resolveRequestOrigin:()=> 'https://fixture.invalid'},
 '@/lib/ops-roles':{opsRoleCan},'@/lib/local-operations-answer':localModule,
 '@/lib/local-territory-demand-answer':{buildLocalTerritoryDemandAnswer:()=>null},
 '@/lib/local-crew-revenue-answer':{buildLocalCrewRevenueAnswer:()=>null},
 '@/lib/ask-opsbot-agent':{readOpenAIKey:()=>{providerReads++;throw Error('Credential access forbidden in local route');},runAskOpsBot:()=>{throw Error('Provider forbidden');}},
 '@/lib/ask-opsbot-ledger':{readAskOpsBotLedger:()=>{throw Error('Ledger read forbidden');},reserveAskOpsBotQuestion:()=>{reserves++;throw Error('Reservation forbidden');},settleAskOpsBotQuestion:()=>{throw Error('Ledger write forbidden');}},
 '@/lib/metered-usage-policy':{askOpsBotApproved:()=>false},
};
async function main(){
 for(const file of ['../app/api/desktop/ask-opsbot/local/route.ts','../app/api/desktop/ask-opsbot/route.ts']){
  const compiled=ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const handler:any={};new Function('require','exports',compiled)((name:string)=>{assert(name in dependencies,name);return dependencies[name];},handler);
  const send=(question='Who was on today?',date='2026-10-02',origin='https://fixture.invalid',raw?:string)=>handler.POST(new Request('https://fixture.invalid/api/test',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:raw??JSON.stringify({question,date})}));
  signedIn=false;assert.equal((await send()).status,401);signedIn=true;
  role='operator';assert.equal((await send()).status,403);role='manager';
  assert.equal((await send(undefined,undefined,'https://other.invalid')).status,403);
  assert.equal((await send('Who was on today?','2026-02-30')).status,400);
  assert.equal((await send(undefined,undefined,undefined,'{broken')).status,400);
  assert.equal((await send(undefined,undefined,undefined,'null')).status,400);
  assert.equal((await send(undefined,undefined,undefined,'[]')).status,400);
  const response=await send();assert.equal(response.status,200);assert.match(response.headers.get('cache-control')||'',/no-store/);
  assert.match((await response.json()).answer,/Alex Example/);
  failSource=true;assert.equal((await send()).status,503);failSource=false;
  const unsupported=await send('Why did sales fall?');assert.equal(unsupported.status,file.includes('/local/')?200:503);
 }
 assert.equal(providerReads,0);assert.equal(reserves,0);assert.equal(localReads,6);
 const start=performance.now();for(let i=0;i<200;i++)ask('Who was on today?');
 console.log(`Local source lookup and both HTTP handlers passed; synthetic warm crew average ${((performance.now()-start)/200).toFixed(3)} ms (excludes import, disk, HTTP, auth, and provider).`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
