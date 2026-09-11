import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { validClientEvidence } from '../desktop-ui/lib/maintenance-evidence';
let authenticated=true, allowed=true, origin=true, unchanged=true, writes=0;
const dependencies:Record<string,unknown>={
 'next/headers':{cookies:async()=>({get:()=>({value:'mock'})})},
 '@/lib/auth':{AUTH_SESSION_COOKIE:'mock',verifyAuthSessionCookie:async()=>authenticated?{email:'mock'}:null,opsAuthRole:()=> 'operator'},
 '@/lib/ops-roles':{opsRoleCan:()=>allowed},
 '@/lib/desktop-request-origin':{isDesktopWriteOriginAllowed:()=>origin},
 '@/desktop-ui/lib/maintenance-evidence':{validClientEvidence},
 '@/lib/maintenance-monitor':{verifyClientInteraction:()=>{if(unchanged)writes++;return unchanged;},recordClientEvent:()=>{writes++;return true;},maintenanceDirectory:()=>'/mock',maintenanceSnapshot:()=>({}),readClientEvents:()=>({})},
 '@/lib/maintenance-recovery':{recoverySnapshot:()=>({})},
};
function handler(file:string){const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports:{POST?:(request:Request)=>Promise<Response>}={};new Function('require','exports',output)((key:string)=>{assert(key in dependencies,`Unexpected import ${key}`);return dependencies[key];},exports);return exports.POST!;}
const verify=handler('app/api/desktop/maintenance/verify/route.ts'),report=handler('app/api/desktop/maintenance/route.ts');
const req=(value:unknown)=>new Request('https://fixture.test/api/desktop/maintenance/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:typeof value==='string'?value:JSON.stringify(value)});
async function main(){
 const payload={category:'schedule-closeout',failureAt:123};
 authenticated=false;assert.equal((await verify(req(payload))).status,401);authenticated=true;
 allowed=false;assert.equal((await verify(req(payload))).status,403);allowed=true;
 origin=false;assert.equal((await verify(req(payload))).status,403);origin=true;
 assert.equal((await verify(req({...payload,message:'private'}))).status,400);
 assert.equal((await verify(req('x'.repeat(200)))).status,413);
 unchanged=false;assert.equal((await verify(req(payload))).status,409);unchanged=true;
 assert.equal(writes,0);assert.equal((await verify(req(payload))).status,202);assert.equal(writes,1);
 assert.equal((await report(req({category:'schedule-closeout',method:'POST',status:503,failure:'http'}))).status,204);
 assert.equal((await report(req({category:'javascript',stack:'private'}))).status,400);
 assert.equal((await report(req({category:'../../escape'}))).status,400);
 // Exercise the real workflow probe while replacing only its read boundaries.
 const workflow=ts.transpileModule(fs.readFileSync('scripts/check-maintenance-workflows.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const reads={ '../lib/report-dates':{chicagoDateKey:()=> '2026-09-11'},'../lib/desktop-schedule':{readDesktopSchedule:()=>({date:'2026-09-11',observedAt:'current',appointments:[],fleet:{trucks:[]}})},'../lib/desktop-fleet':{readDesktopFleet:()=>{throw Error('private source error');}},'../desktop-ui/lib/maintenance-evidence':{validReadSnapshot:()=>true}};
 let result='';new Function('require','exports','process',workflow)((key:keyof typeof reads)=>{assert(key in reads);return reads[key];},{},{stdout:{write:(text:string)=>{result=text;}}});
 assert.deepEqual(JSON.parse(result),{schedule:true,fleet:false});assert(!result.includes('private'));
 console.log('Maintenance HTTP checks passed: authentication, role, origin, bounded payload, stale evidence rejection, accepted pending state, privacy, and read-only probe isolation.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
