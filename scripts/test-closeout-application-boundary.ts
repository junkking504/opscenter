import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { authorizeOpsRequest, type InteractiveOpsRole } from '../lib/ops-roles';
import { parseClassificationChange } from '../lib/appointment-classification';

// Execute the real route and process-adapter code, replacing every side effect.
function load(file: string, dependencies: Record<string, unknown>) {
  const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const exports: Record<string, any>={};
  new Function('require','exports',compiled)((name:string)=>{assert.ok(name in dependencies,`Unmocked dependency ${name}`);return dependencies[name];},exports);
  return exports;
}
let application='', calls=0, failure='', signedIn=true, role:InteractiveOpsRole='manager', publications=0;
const adapter=load('lib/junkware-job-closeout.ts',{
  'node:path':path,
  'node:util':{promisify:(fn:unknown)=>fn},
  'node:child_process':{execFile:async(_executable:string,args:string[])=>{
    calls++;application=args[args.indexOf('--application')+1];
    if(failure)throw {stderr:JSON.stringify({stage:failure,error:'Synthetic source failure',code:'fixture'})};
    return {stdout:JSON.stringify({ok:true,appointmentId:'1234',closeout:{status:{value:'8'},appointmentType:{label:'Estimate'},photoEvidence:{appointmentId:'1234',urls:[]}},verifiedAt:'2026-10-04T18:20:24Z'})};
  }},
});
const dependencies={
  'next/headers':{cookies:async()=>({get:()=>({value:'fixture'})})},
  'next/server':{NextResponse:Response,after:()=>{publications++;}},
  '@/lib/auth':{AUTH_SESSION_COOKIE:'fixture',verifyAuthSessionCookie:async()=>signedIn?{email:'fixture-manager',role}:null},
  '@/lib/ops-roles':{authorizeOpsRequest},
  '@/lib/desktop-request-origin':{isDesktopWriteOriginAllowed:(request:Request)=>request.headers.get('origin')===new URL(request.url).origin},
  '@/lib/job-route-assignments':{withJunkwareAppointmentSyncLock:async(_id:string,run:()=>unknown)=>run()},
  '@/lib/junkware-job-closeout':adapter,
  '@/lib/publish-closeout':{publishVerifiedCloseout:()=>{throw new Error('No external publication permitted');}},
  '@/lib/truck-load-closeouts':{updateVerifiedCloseoutLoad:()=>({updated:true})},
  '@/lib/appointment-classification':{parseClassificationChange,recordAppointmentClassification:()=>{}},
  '../closeout/route':{GET:()=>{}},
};
const routes=[load('app/api/job-closeout/route.ts',dependencies),load('app/api/desktop/schedule/classification/route.ts',dependencies)];
async function main(){
  const payload={appointmentId:'1234',date:'2026-10-04',targetStatus:'8',appointmentType:'Estimate',completeEstimate:true,expectedSourceVersion:'a'.repeat(64),estimateOutcome:{reason:'Other',explanation:'Fixture',noDiscountReason:'Fixture'}};
  for(const route of routes){
    const send=(body=payload,origin='https://fixture.invalid')=>route.POST(new Request('https://fixture.invalid/api/job-closeout?application=opscenter',{method:'POST',headers:{origin,'Content-Type':'application/json','X-Closeout-Application':'opscenter'},body:JSON.stringify(body)}));
    const before=calls;
    signedIn=false;assert.equal((await send()).status,401,'A crew phone without an OpsCenter session cannot use the office writer');
    signedIn=true;role='operator';assert.equal((await send()).status,403);
    role='manager';assert.equal((await send(payload,'https://untrusted.invalid')).status,403);
    assert.equal(calls,before,'Rejected requests never invoke a provider');
    for(const allowed of ['manager','admin'] as const){role=allowed;const result=await send();assert.equal(result.status,200);assert.equal(application,'opscenter');assert.deepEqual((await result.json()).closeout.photoEvidence.urls,[]);}
    if(route===routes[1]){assert.equal((await send({...payload,completeEstimate:false})).status,200);assert.equal(application,'waypoint','Unrelated classification keeps its original photo policy');}
    failure='preflight';assert.equal((await send()).status,409);
    failure='uncertain';assert.equal((await send()).status,502);failure='';
  }
  await adapter.junkwareJobCloseout('1234',{...payload,application:'opscenter',requirePhotos:false});
  assert.equal(application,'waypoint','Payload cannot override the trusted adapter argument');
  await adapter.opscenterJobCloseout('1234',{...payload,application:'waypoint'});
  assert.equal(application,'opscenter','Office policy is not selected from client input');
  assert.equal(publications,2,'Only successful ordinary office closeouts queue the existing publication hook; no hook is executed');
  console.log('PASS: real OpsCenter routes + process adapter, manager/admin access, no-session/operator/origin denial, zero-photo success, fixed application argument, preflight/uncertain failures. All effects mocked.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
