import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {crewPhoneBody,crewPhoneResponse,crewPhoneFailure} from '../lib/crew-phone-http';
import {CrewPhoneError} from '../lib/crew-phone';
import * as policy from '../lib/waypoint-manager-policy';
let accountAllowed=false;
let allowed=true,reads=0,delegated=0,contexts=0,transfers=0,bodySeen:unknown;
const phone={deviceId:'fixture',truck:'Truck 1'};
const mocks:Record<string,unknown>={
 '@/lib/waypoint-account':{waypointAccount:async()=>accountAllowed?{email:"fixture@junk-king.com",role:"manager"}:null},
 '@/lib/crew-phone-http':{crewPhoneBody,crewPhoneResponse,crewPhoneFailure},
 '@/lib/waypoint-manager-context':{requireWaypointManager:()=>{if(!allowed)throw new CrewPhoneError('Denied',403);return phone;},withWaypointManager:(_r:Request,run:()=>unknown)=>run()},
 '@/lib/waypoint-manager-policy':policy,
 '@/lib/desktop-schedule':{readDesktopSchedule:()=>{reads++;return {observedAt:'2026-10-16T12:00:00Z',appointments:[{appointmentId:'1',truck:'Truck 9'}]};}},
 '@/lib/chicago-date':{chicagoDateKey:()=> '2026-10-16'},
 '@/lib/crew-phone':{CrewPhoneError},
 '@/lib/crew-phone-day':{readCrewDay:()=>null,crewDayRoster:()=>['Fixture Driver'],saveCrewDay:(_p:unknown,body:unknown)=>{contexts++;return body;}},
 '@/lib/junkware-trucks':{JUNKWARE_DISPATCH_TRUCKS:['Truck 1','Truck 9']},
 '@/lib/crew-truck-switch-store':{pendingTruckSwitch:()=>null,transfer:()=>{transfers++;}},
};
for(const path of ['desktop/schedule/operations','desktop/schedule/creation','desktop/schedule/creation/check','desktop/schedule/customers','desktop/schedule/order','desktop/schedule/closeout','crew-phones','crew-dispatch'])mocks[`@/app/api/${path}/route`]={GET:async(r:Request)=>{delegated++;assert.ok(new URL(r.url).pathname.endsWith(path));return Response.json({ok:true});},POST:async(r:Request)=>{delegated++;bodySeen=await r.json();assert.ok(new URL(r.url).pathname.endsWith(path));return Response.json({ok:true});}};
const compiled=ts.transpileModule(fs.readFileSync('app/api/crew-jobs/manager/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports:Record<string,unknown>={};vm.runInNewContext(compiled,{exports,require:(name:string)=>{assert.ok(name in mocks,name);return mocks[name];},URL,Request,Response,Date,Object});
const get=exports.GET as (r:Request)=>Promise<Response>,post=exports.POST as typeof get;
const req=(resource:string,body?:unknown,origin='https://waypoint.example.invalid')=>new Request(`https://waypoint.example.invalid/api/crew-jobs/manager?resource=${resource}`,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
async function main(){
 const snapshot=await (await get(req('schedule'))).json();assert.equal(snapshot.appointments[0].truck,'Truck 9');assert.equal(reads,1);assert.equal(delegated,0,'Browsing never invokes office recovery or mutations');
 assert.equal((await post(req('operations',{action:'note',values:{note:'fixture'}}))).status,200);assert.deepEqual(bodySeen,{action:'note',values:{note:'fixture'}});
 const before=delegated;
 for(const [resource,body] of [['operations',{action:'closeout',values:{targetStatus:'8'}}],['operations',{action:'closeout',values:{targetStatus:'1',addPayment:{methodId:'cash'}}}],['phones',{action:'send-setup'}],['payroll',{action:'update'}]] as const)assert.ok((await post(req(resource,body))).status>=400);
 assert.equal(delegated,before,'Denied actions never reach a writer');
 assert.equal((await post(req('operations',{action:'note'},'https://evil.invalid'))).status,403);assert.equal(delegated,before);
 assert.equal((await post(req('context',{date:'2026-10-16',truck:'Truck 9',driver:'Fixture Driver',responsible:'Fixture Driver',navigators:[],requestId:'fixture',expectedVersion:0}))).status,200);assert.equal(contexts,1);assert.equal(transfers,0,'Manager work context never transfers jobs');
 allowed=false;assert.equal((await get(req('schedule'))).status,403);assert.equal(reads,1);assert.equal((await post(req('context',{truck:'Truck 9'}))).status,403);assert.equal(contexts,1);
 accountAllowed=true;
 const accountSnapshot=await (await get(req('schedule'))).json();assert.equal(accountSnapshot.phone,null);assert.equal(accountSnapshot.day,null);assert.equal(reads,2);
 assert.equal((await post(req('context',{truck:'Truck 9'}))).status,403);assert.equal(contexts,1,'Accounts cannot manufacture phone work context');
 assert.equal((await post(req('operations',{action:'note',values:{note:'account fixture'}}))).status,200);
 assert.equal((await post(req('phones',{action:'send-setup'}))).status,403);
 allowed=true;const dualSnapshot=await (await get(req('schedule'))).json();assert.equal(dualSnapshot.phone.deviceId,phone.deviceId);
 assert.equal((await post(req('context',{truck:'Truck 9'}))).status,200);assert.equal(contexts,2,'Named accounts retain approved phone work context');
 console.log('PASS: manager gateway rejects unauthorized/CSRF/unsafe actions before delegates, reads all trucks without mutations, and changes explicit crew context without transferring appointments. Synthetic handlers only.');
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
