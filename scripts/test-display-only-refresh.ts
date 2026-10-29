import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let authenticated=true,allowed=true,sourceRequests=0,background=0,receiptWrites=0;
const snapshot={date:'2026-10-25',observedAt:'fixture',appointments:[]};
const mocks:Record<string,unknown>={
 'next/headers':{cookies:async()=>({get:()=>({value:'fixture'})})},
 '@/lib/auth':{AUTH_SESSION_COOKIE:'fixture',verifyAuthSessionCookie:async()=>authenticated?{email:'fixture@example.invalid',role:'admin'}:null},
 '@/lib/report-dates':{chicagoDateKey:()=>snapshot.date},
 '@/lib/desktop-schedule':{readDesktopSchedule:()=>snapshot},
 '@/lib/requested-schedule-day':{requestScheduleDay:()=>{sourceRequests++;return {status:'queued'};}},
 '@/lib/release-after':{trackedAfter:()=>{background++;}},
 '@/lib/ops-roles':{authorizeOpsRequest:()=>({allowed})},
 '@/lib/desktop-schedule-operations':{scheduleMoveRecovery:async()=>({candidate:'fixture',notices:[{message:'Move warning'}]}),automaticallyCheckMove:()=>{throw Error('No live source allowed');}},
 '@/lib/job-route-assignments':{withJunkwareAppointmentSyncLock:()=>{throw Error('No source lock allowed');}},
 '@/lib/junkware-truck-assignment':{readJunkwareTruckAssignment:()=>{throw Error('No source query allowed');}},
 '@/lib/truck-pickup-source-notes':{recordNextPickupSourceNote:()=>{throw Error('No source note allowed');},pickupSourceNoteNotices:(_date:unknown,_jobs:unknown,options:{readOnly:boolean})=>{if(!options.readOnly)receiptWrites++;return [{message:'Pickup warning'}];}},
};
const exports:Record<string,unknown>={};
const source=fs.readFileSync('app/api/desktop/schedule/route.ts','utf8');
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>{assert.ok(name in mocks,name);return mocks[name];},Response,URL,Date,Number});
const get=exports.GET as (request:Request)=>Promise<Response>;
async function main(){
for(const query of ['displayOnly=1','displayOnly=1&load=1&refresh=1']){
 const response=await get(new Request(`https://example.invalid/api/desktop/schedule?${query}`));
 assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.assignmentRecoveryNotices.length,2,'warnings retained');assert.equal(body.sourceRequest,undefined);
}
assert.deepEqual([sourceRequests,background,receiptWrites],[0,0,0],'display refresh must not schedule source jobs or write receipts');
await get(new Request('https://example.invalid/api/desktop/schedule?load=1&refresh=1'));
assert.deepEqual([sourceRequests,background,receiptWrites],[1,2,1],'normal source refresh remains unchanged');
allowed=false;
const body=await (await get(new Request('https://example.invalid/api/desktop/schedule?displayOnly=1'))).json();
assert.equal(body.assignmentRecoveryNotices.length,1,'role permission preserved');
authenticated=false;assert.equal((await get(new Request('https://example.invalid/api/desktop/schedule?displayOnly=1'))).status,401);
authenticated=true;assert.equal((await get(new Request('https://example.invalid/api/desktop/schedule?displayOnly=1&date=invalid'))).status,400);
verifyPickupNotices();
console.log('Display-only refresh route PASS: source jobs/receipt writes blocked, warnings/auth/date/normal flow preserved.');

}
function verifyPickupNotices(){
 const key='a'.repeat(64),receipt={key,date:snapshot.date,appointmentId:'101',note:'synthetic note',status:'uncertain',updatedAt:'2026-10-25T00:00:00Z'};
 let writes=0;
 const localExports:Record<string,unknown>={};
 const localMocks:Record<string,unknown>={
  'node:fs':{default:{readdirSync:()=>[`${key}.json`],readFileSync:()=>JSON.stringify(receipt),writeFileSync:()=>{writes++;},renameSync:()=>{}}},
  'node:path':{default:{join:(...parts:string[])=>parts.join('/')}},
  'node:crypto':{randomUUID:()=> 'fixture'},
 };
 const compiled=ts.transpileModule(fs.readFileSync('lib/truck-pickup-source-notes.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{exports:localExports,require:(name:string)=>localMocks[name]||{},process:{env:{OPSCENTER_DATA_DIR:'/synthetic'},cwd:()=>'/synthetic'},Date,Map});
 const notices=localExports.pickupSourceNoteNotices as (date:string,jobs:unknown[],options?:{readOnly:boolean})=>unknown[];
 assert.equal(notices(snapshot.date,[{appointmentId:'101',appointmentNotes:['synthetic note']}],{readOnly:true}).length,0);
 assert.equal(writes,0,'matching note can be displayed without receipt mutation');
 assert.equal(notices(snapshot.date,[{appointmentId:'101',appointmentNotes:[]}],{readOnly:true}).length,1,'unverified note warning retained');
 assert.equal(writes,0);
 notices(snapshot.date,[{appointmentId:'101',appointmentNotes:['synthetic note']}]);assert.equal(writes,1,'existing verification behavior preserved');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
