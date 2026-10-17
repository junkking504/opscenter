import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {authorizeOpsRequest} from '../lib/ops-roles';
import {CrewPhoneError} from '../lib/crew-phone';
let manager=true,open=true,revoked=false,writes=0,reads=0;
class JunkwareCloseoutError extends Error {constructor(message:string,readonly stage:string){super(message);}}
const actor=()=>{if(revoked)throw new CrewPhoneError('Revoked',403);return manager?{email:'waypoint-manager:fixture',role:'manager'}:null;};
const dependencies:Record<string,unknown>={
 '@/lib/waypoint-manager-context':{waypointManagerActor:actor},
 '@/lib/ops-roles':{authorizeOpsRequest},
 '@/lib/desktop-request-origin':{isDesktopWriteOriginAllowed:()=>true},
 'next/headers':{cookies:async()=>({get:()=>undefined})},'next/server':{NextResponse:Response},
 '@/lib/release-after':{trackedAfter:()=>{throw Error('No publication for an open-job edit');}},
 '@/lib/auth':{AUTH_SESSION_COOKIE:'fixture',verifyAuthSessionCookie:async()=>null},
 '@/lib/job-route-assignments':{withJunkwareAppointmentSyncLock:async(_id:string,run:()=>unknown)=>run()},
 '@/lib/junkware-job-closeout':{JunkwareCloseoutError,junkwareJobCloseout:async()=>{reads++;return {closeout:{status:{value:open?'1':'8'}}};},opscenterJobCloseout:async(_id:string,payload:Record<string,unknown>)=>{writes++;assert.equal(payload.targetStatus,'1');assert.equal(payload.addPayment,undefined);return {closeout:{status:{value:'1'}}};}},
 '@/lib/publish-closeout':{publishVerifiedCloseout:()=>{throw Error('No external notification');}},
 '@/lib/truck-load-closeouts':{updateVerifiedCloseoutLoad:()=>{throw Error('No closeout load mutation');}},
};
const compiled=ts.transpileModule(fs.readFileSync('app/api/job-closeout/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports:Record<string,any>={};new Function('require','exports',compiled)((name:string)=>{assert.ok(name in dependencies,name);return dependencies[name];},exports);
const send=(payload:Record<string,unknown>)=>exports.POST(new Request('https://fixture.invalid/api/job-closeout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appointmentId:'123',...payload})}));
async function main(){
 manager=false;assert.equal((await send({targetStatus:'1'})).status,401);manager=true;
 for(const payload of [{targetStatus:'8'},{targetStatus:'1',addPayment:{methodId:'cash'}},{targetStatus:'1',requirePhotos:false},{targetStatus:'1',application:'opscenter'}])assert.equal((await send(payload)).status,403);
 assert.equal(reads,0);assert.equal(writes,0);
 open=false;assert.equal((await send({targetStatus:'1'})).status,409);assert.equal(writes,0);
 open=true;assert.equal((await send({targetStatus:'1',loadPrice:'100'})).status,200);assert.equal(writes,1);
 // Revoke while source read is in progress: the second authorization check must precede the writer.
 (dependencies['@/lib/junkware-job-closeout'] as any).junkwareJobCloseout=async()=>{revoked=true;return {closeout:{status:{value:'1'}}};};
 assert.notEqual((await send({targetStatus:'1'})).status,200);assert.equal(writes,1);
 console.log('PASS: actual manager appointment-edit handler rejects completion, payment/photo overrides, closed-source edits and mid-read revocation before writing. Synthetic source adapter only.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
