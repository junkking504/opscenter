import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Exercise the real HTTP handler while address verification cannot finish.
// All source, auth and collector boundaries are synthetic.
const snapshot = {date:'2026-09-10',observedAt:'2026-09-10T22:00:00Z',appointments:[
  {recordId:'canceled',status:'Cancelled by Dispatcher',location:null},
  {recordId:'active',status:'Confirmed',location:null},
]};
let authorized = true, verifications = 0, requested = 0;
const dependencies: Record<string, unknown> = {
  'next/headers':{cookies:async()=>({get:()=>({value:'synthetic'})})},
  '@/lib/auth':{AUTH_SESSION_COOKIE:'test',verifyAuthSessionCookie:async()=>authorized?{role:'manager'}:null},
  '@/lib/report-dates':{chicagoDateKey:()=>snapshot.date},
  '@/lib/desktop-schedule':{
    readDesktopSchedule:()=>snapshot,
    readVerifiedDesktopSchedule:()=>{verifications++;return new Promise(()=>{});},
  },
  '@/lib/requested-schedule-day':{requestScheduleDay:()=>{requested++;return {state:'queued'};}},
};
const compiled = ts.transpileModule(fs.readFileSync(new URL('../app/api/desktop/schedule/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports: {GET?:(request:Request)=>Promise<Response>} = {};
new Function('require','exports',compiled)((name:string)=>{
  assert(name in dependencies,`Unexpected dependency: ${name}`);
  return dependencies[name];
},exports);
async function main() {
  let timeout: ReturnType<typeof setTimeout>;
  const response = await Promise.race([
    exports.GET!(new Request('https://example.test/api/desktop/schedule?date=2026-09-10&load=1')),
    new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('Board waited for geocoding')),250);}),
  ]).finally(()=>clearTimeout(timeout));
  assert.equal(response.status,200);
  const body=await response.json();
  assert.deepEqual(body.appointments,snapshot.appointments,'Retain canceled and active source records without fabricating coordinates');
  assert.equal(body.sourceRequest.state,'queued');
  assert.equal(requested,1);
  assert.equal(verifications,0);
  assert.equal((await exports.GET!(new Request('https://example.test/api/desktop/schedule?date=bad'))).status,400);
  authorized=false;
  assert.equal((await exports.GET!(new Request('https://example.test/api/desktop/schedule'))).status,401);
  console.log('Schedule snapshot route passed: immediate source records despite unavailable geocoding, collector request, date validation and authentication.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
