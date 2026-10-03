import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { buildLocalCrewPerformanceAnswer } from '../lib/local-crew-performance-answer';
import { searchSubmission } from '../desktop-ui/lib/search-intent';
import { opsRoleCan, type InteractiveOpsRole } from '../lib/ops-roles';
import { validLookupDate } from '../lib/local-operations-answer';
import type { readDesktopKrewe } from '../lib/desktop-krewe';
const question = 'based on metrics, who is the highest performing employee in our system';
let calls = 0;
let missingDates: string[] = [];
let rows = [
 { name: 'Alex Example', revenue: 900, jobs: 9, hours: 30, days: [{ revenue: 900, jobs: 9, hours: 30 }] },
 { name: 'Sam Example', revenue: 700, jobs: 10, hours: 10, days: [{ revenue: 700, jobs: 10, hours: 10 }] },
 { name: 'Missing Example', revenue: null, jobs: null, hours: null, days: [{ revenue: null, jobs: null, hours: null }] },
];
const read = ((end: string) => { calls++; return { start: `${end.slice(0,7)}-01`, end, sourceUpdatedAt: '2026-09-30T22:00:00Z', members: rows, missingDates }; }) as unknown as typeof readDesktopKrewe;
const ask = (q=question, role:InteractiveOpsRole='manager', date='2026-10-03') => buildLocalCrewPerformanceAnswer(q,date,role,read,'2026-10-03');
for(const q of [question,'based on metrics, who is the best employee in our system','Looks like we are falling behind—explain what changed','Help me understand where the money went','Anything unusual with the trucks','Which team members are pulling the most weight?']) assert.equal(searchSubmission(q,true,[],[]),'assistant');
assert.equal(searchSubmission('JK4105118',true,[],[{title:'JK4105118 · Example job'}]),'record');
assert.equal(searchSubmission('Alex Example',true,[],[{title:'Alex Example'}]),'record');
assert.equal(searchSubmission('Crew',true,['Krewe','Crew'],[]),'command');
assert.equal(searchSubmission(question,false,[],[]),'none');
assert.equal(ask(question,'operator'),null);assert.equal(calls,0);
let answer=ask()!;
assert.match(answer.answer,/Alex Example\*\*|Alex Example leads/);
assert.match(answer.answer,/2026-09-01–2026-09-30/);
assert.match(answer.answer,/\$900.00/);assert.match(answer.answer,/1 excluded/);
assert.match(ask('Who is the top employee by revenue per hour?')!.answer,/Sam Example leads/);
assert.match(ask('Who is the top employee by jobs?')!.answer,/Sam Example leads/);
assert.match(ask('Who is the best employee this month?')!.answer,/2026-10-01–2026-10-03/);
assert.match(ask('Who is the best employee September 2026?')!.answer,/2026-09-01–2026-09-30/);
const before=calls;
for(const q of ['Who is the best employee this year?','Who is the best employee last week?','Who is the best employee September and August?','Who is the best employee this month in September?','Who is the best employee since September?'])assert.match(ask(q)!.answer,/support one calendar month/);
assert.match(ask('Who is the best employee by safety?')!.answer,/does not establish a leader/);
assert.match(ask('Who is the best employee in December 2026?')!.answer,/future/);
assert.equal(calls,before);
assert.equal(ask('Promote the top employee'),null);
assert.equal(ask(question,'manager','2026-02-30'),null);
missingDates=['2026-09-02'];assert.match(ask()!.answer,/provisional/);
rows[1].revenue=900;rows[1].days[0].revenue=900;assert.match(ask()!.answer,/Tied leaders/);
rows[0].days.push({revenue:null,jobs:null,hours:5} as any);
assert.match(ask()!.answer,/partial metric coverage/);
assert.match(ask('Who is the top employee by revenue per hour?')!.answer,/Sam Example leads/);
rows=[];assert.match(ask()!.answer,/No positive credited revenue/);

// Both real handlers must answer before credential or paid-ledger access.
let signedIn=true,role:InteractiveOpsRole='manager',failSource=false;
const dependencies:Record<string,unknown>={
 'node:crypto':{createHash:()=>{throw Error('No provider path');}},
 'next/headers':{cookies:async()=>({get:()=>({value:'synthetic'})})},
 '@/lib/auth':{AUTH_SESSION_COOKIE:'fixture',verifyAuthSessionCookie:async()=>signedIn?{email:'fixture',role}:null,resolveRequestOrigin:()=> 'https://fixture.invalid'},
 '@/lib/ops-roles':{opsRoleCan},
 '@/lib/local-crew-performance-answer':{buildLocalCrewPerformanceAnswer:(q:string,d:string,r:InteractiveOpsRole)=>{if(failSource)throw Error('source unavailable');return buildLocalCrewPerformanceAnswer(q,d,r,read,'2026-10-03');}},
 '@/lib/local-operations-answer':{validLookupDate,buildLocalOperationsAnswer:()=>null},
 '@/lib/local-territory-demand-answer':{buildLocalTerritoryDemandAnswer:()=>null},
 '@/lib/local-crew-revenue-answer':{buildLocalCrewRevenueAnswer:()=>null},
 '@/lib/ask-opsbot-agent':{readOpenAIKey:()=>{throw Error('No credentials');},runAskOpsBot:()=>{throw Error('No provider');}},
 '@/lib/ask-opsbot-ledger':{readAskOpsBotLedger:()=>{throw Error('No ledger');},reserveAskOpsBotQuestion:()=>{throw Error('No reservation');},settleAskOpsBotQuestion:()=>{throw Error('No settlement');}},
 '@/lib/metered-usage-policy':{askOpsBotApproved:()=>{throw Error('Local answer must precede paid gate');}},
};
async function main(){
 for(const file of ['../app/api/desktop/ask-opsbot/local/route.ts','../app/api/desktop/ask-opsbot/route.ts']){
  const compiled=ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const handler:any={};new Function('require','exports',compiled)((name:string)=>{assert(name in dependencies,name);return dependencies[name];},handler);
  const send=(origin='https://fixture.invalid')=>handler.POST(new Request('https://fixture.invalid/api/test',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({question,date:'2026-10-03'})}));
  signedIn=false;assert.equal((await send()).status,401);signedIn=true;
  role='operator';assert.equal((await send()).status,403);role='manager';
  assert.equal((await send('https://other.invalid')).status,403);
  const response=await send();assert.equal(response.status,200);assert.match(response.headers.get('cache-control')||'',/no-store/);assert.equal((await response.json()).matched,true);
  failSource=true;assert.equal((await send()).status,503);failSource=false;
 }
 console.log('Employee comparisons: defaults, explicit metrics/periods, missing evidence, ties, Enter intent, and manager-only no-spend HTTP routes passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
