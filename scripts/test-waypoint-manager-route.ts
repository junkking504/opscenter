import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {crewPhoneBody,crewPhoneResponse,crewPhoneFailure} from '../lib/crew-phone-http';
import {CrewPhoneError} from '../lib/crew-phone';
import * as policy from '../lib/waypoint-manager-policy';
import * as photoPolicy from '../lib/waypoint-manager-photos';
import type {DesktopAppointment} from '../lib/desktop-schedule';
let accountAllowed=false,downloads=0,revokeDuringDownload=false,removeDuringDownload=false;
const sourcePhoto={url:'https://junkware.junk-king.com/system/aspnet/local/media/fixture-1-before.jpg',category:'Before',fileName:'fixture-1-before.jpg'};
let photoRows=[{appointmentId:'1',recordId:'2026-10-16:appointment:1',truck:'Truck 9',photos:[sourcePhoto]},{appointmentId:'2',recordId:'2026-10-16:appointment:2',truck:'Truck 1',photos:[]}] as unknown as DesktopAppointment[];
let allowed=true,reads=0,delegated=0,contexts=0,transfers=0,bodySeen:unknown;
const phone={deviceId:'fixture',truck:'Truck 1'};
const mocks:Record<string,unknown>={
 '@/lib/waypoint-account':{waypointAccount:async()=>accountAllowed?{email:"fixture@junk-king.com",role:"manager"}:null},
 '@/lib/crew-phone-http':{crewPhoneBody,crewPhoneResponse,crewPhoneFailure},
 '@/lib/waypoint-manager-context':{requireWaypointManager:()=>{if(!allowed)throw new CrewPhoneError('Denied',403);return phone;},withWaypointManager:(_r:Request,run:()=>unknown)=>run()},
 '@/lib/waypoint-manager-policy':policy,
 '@/lib/waypoint-manager-photos':{...photoPolicy,readManagerPhoto:async()=>{downloads++;if(revokeDuringDownload){allowed=false;accountAllowed=false;}if(removeDuringDownload)photoRows=[];return {bytes:Buffer.from([255,216,255]),mimeType:'image/jpeg'};}},
 '@/lib/desktop-schedule':{readDesktopSchedule:()=>{reads++;return {observedAt:'2026-10-16T12:00:00Z',appointments:photoRows};}},
 '@/lib/chicago-date':{chicagoDateKey:()=> '2026-10-16'},
 '@/lib/crew-phone':{CrewPhoneError},
 '@/lib/crew-phone-day':{readCrewDay:()=>null,crewDayRoster:()=>['Fixture Driver'],saveCrewDay:(_p:unknown,body:unknown)=>{contexts++;return body;}},
 '@/lib/junkware-trucks':{JUNKWARE_DISPATCH_TRUCKS:['Truck 1','Truck 9']},
 '@/lib/crew-truck-switch-store':{pendingTruckSwitch:()=>null,transfer:()=>{transfers++;}},
};
for(const path of ['desktop/schedule/operations','desktop/schedule/creation','desktop/schedule/creation/check','desktop/schedule/customers','desktop/schedule/order','desktop/schedule/closeout','crew-phones','crew-dispatch'])mocks[`@/app/api/${path}/route`]={GET:async(r:Request)=>{delegated++;assert.ok(new URL(r.url).pathname.endsWith(path));return Response.json({ok:true,sourceVersion:'unchanged',closeout:{photoEvidence:{appointmentId:'1',urls:[sourcePhoto.url]}},receipt:{status:'uncertain',requestId:'saved',sourceResult:{photos:[sourcePhoto]}}});},POST:async(r:Request)=>{delegated++;bodySeen=await r.json();assert.ok(new URL(r.url).pathname.endsWith(path));return Response.json({ok:true});}};
const compiled=ts.transpileModule(fs.readFileSync('app/api/crew-jobs/manager/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports:Record<string,unknown>={};vm.runInNewContext(compiled,{exports,require:(name:string)=>{assert.ok(name in mocks,name);return mocks[name];},URL,Request,Response,Date,Object,Uint8Array,Headers});
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
 const editView=await (await get(req('edit'))).json();assert.equal(editView.sourceVersion,'unchanged');assert.equal(editView.receipt.status,'uncertain');assert.equal(editView.receipt.requestId,'saved');assert.ok(!JSON.stringify(editView).includes(sourcePhoto.url),'Delegated edit and receipt evidence does not expose media URLs');
 const imageUrl='https://waypoint.example.invalid'+photoPolicy.managerPhotoUrl('2026-10-16',photoRows[0],sourcePhoto.url);
 accountAllowed=false;allowed=false;const priorReads=reads;assert.equal((await get(new Request(imageUrl))).status,403);assert.equal(reads,priorReads);assert.equal(downloads,0,'Ordinary crew cannot read manager image bytes');
 allowed=true;const image=await get(new Request(imageUrl));assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(image.headers.get('cross-origin-resource-policy'),'same-origin');assert.equal(image.headers.get('x-content-type-options'),'nosniff');assert.equal(downloads,1,'Existing manager grant includes other trucks');
 const leaked=JSON.stringify(await (await get(req('schedule'))).json());assert.ok(!leaked.includes(sourcePhoto.url),'Manager snapshot redacts source URL');
 const wrong=new URL(imageUrl);wrong.searchParams.set('recordId',photoRows[1].recordId);assert.equal((await get(new Request(wrong))).status,404);assert.equal(downloads,1);
 assert.equal((await get(new Request(imageUrl,{headers:{'sec-fetch-site':'cross-site'}}))).status,403);assert.equal(downloads,1);
 assert.equal((await post(req('photo',{action:'write'}))).status,404);assert.equal(downloads,1);
 revokeDuringDownload=true;assert.equal((await get(new Request(imageUrl))).status,403);revokeDuringDownload=false;
 accountAllowed=true;allowed=false;assert.equal((await get(new Request(imageUrl))).status,200,'Named manager account retains existing browse scope');
 revokeDuringDownload=true;assert.equal((await get(new Request(imageUrl))).status,403,'Account rechecked after download');revokeDuringDownload=false;
 accountAllowed=true;removeDuringDownload=true;assert.equal((await get(new Request(imageUrl))).status,404,'Removed/replaced photo cannot be served');
 console.log('PASS manager image route: same manager identities/all-truck grant, ordinary crew denied before reads, exact record binding, no source URL leak, cross-site and POST denied, private response, revocation and removal during download.');
 console.log('PASS: manager gateway rejects unauthorized/CSRF/unsafe actions before delegates, reads all trucks without mutations, and changes explicit crew context without transferring appointments. Synthetic handlers only.');
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
