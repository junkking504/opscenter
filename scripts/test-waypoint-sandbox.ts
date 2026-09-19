import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createCrewPhoneEnrollment,enrollCrewPhone,crewPhone} from '../lib/crew-phone-store';
import {CREW_PHONE_COOKIE} from '../lib/crew-phone';
import {requireCrewReady} from '../lib/crew-phone-http';
import {INSPECTION_SECTIONS} from '../lib/truck-inspection';
import {chicagoDateKey} from '../lib/chicago-date';
import * as day from '../app/api/crew-jobs/day/route';
import * as inspection from '../app/api/crew-jobs/inspection/route';
import * as current from '../app/api/crew-jobs/current/route';
import * as closeout from '../app/api/crew-jobs/closeout/route';
import * as photos from '../app/api/crew-jobs/photos/route';
import * as truckSwitch from '../app/api/crew-jobs/switch-truck/route';

async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'waypoint-sandbox-')),previous={...process.env},originalFetch=globalThis.fetch;
 try{
  process.env.OPS_CREW_PHONE_DIR=path.join(root,'phones');process.env.OPSCENTER_DATA_DIR=root;
  process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE=path.join(root,'limits.json');
  globalThis.fetch=async()=>{throw new Error('Sandbox must never call a provider');};
  const key=randomBytes(32).toString('hex'),enrollment=createCrewPhoneEnrollment('Truck 6','Test phone','test',new Date(),true);
  const phone=enrollCrewPhone(enrollment.code,key);assert.equal(phone.test,true);
  // Legacy enrollment is isolated from immutable delivery evidence, even if connected before this release.
  const legacyKey=randomBytes(32).toString('hex'),legacy=enrollCrewPhone(createCrewPhoneEnrollment('Truck 6','Legacy test','test').code,legacyKey);
  fs.mkdirSync(path.join(root,'phones/deliveries'),{recursive:true});fs.writeFileSync(path.join(root,'phones/deliveries',`${randomUUID()}.json`),JSON.stringify({deviceId:legacy.deviceId,test:true}));
  assert.equal(crewPhone(legacyKey)?.test,true);
  const url='https://waypoint.example.invalid/api/crew-jobs/';
  const request=(endpoint:string,body?:unknown,query='',token=key)=>new Request(`${url}${endpoint}${query}`,{method:body?'POST':'GET',headers:{Cookie:`${CREW_PHONE_COOKIE}=${token}`,Origin:new URL(url).origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.throws(()=>requireCrewReady(request('current')),/Test phones/);
  assert.equal((await current.GET(request('current'))).status,409);
  assert.equal((await day.GET(new Request(url+'day'))).status,401);
  const setup={date:chicagoDateKey(),requestId:randomUUID(),expectedVersion:0,truck:'Truck 6',responsible:'Test Driver',driver:'Test Driver',navigators:['Test Navigator']};
  assert.equal((await day.POST(request('day',setup))).status,200);
  assert.equal((await current.GET(request('current'))).status,409);
  const report={requestId:randomUUID(),truck:'Truck 6',inspector:'Test Driver',odometer:'12345',fuel:'Full',loadLevel:'Empty',startedAt:new Date().toISOString(),answers:INSPECTION_SECTIONS.map(s=>({id:s.id,status:'good',notes:''})),photos:[],status:'clear',notes:'',initials:'TD'};
  const submit={action:'submit',dayVersion:1,report};
  assert.equal((await inspection.POST(request('inspection',submit))).status,200);
  assert.equal((await inspection.POST(request('inspection',submit))).status,200,'Same report recovers');
  const first=await (await current.GET(request('current'))).json();assert.equal(first.job.appointmentId,'TEST-1');
  assert.equal((await closeout.GET(request('closeout',undefined,'?assignmentId=live-job'))).status,409);
  assert.equal((await photos.POST(request('photos',{assignmentId:'live-job'}))).status,403,'Uploads rejected before parsing or provider');
  const preview=await (await truckSwitch.GET(request('switch-truck',undefined,'?truck=Truck%203'))).json();
  assert.equal(preview.preview.count,3);assert.equal(preview.preview.inspection.status,'required');
  const move={action:'confirm',requestId:randomUUID(),to:'Truck 3',fingerprint:preview.preview.fingerprint};
  assert.equal((await truckSwitch.POST(request('switch-truck',move))).status,200);
  assert.equal((await truckSwitch.POST(request('switch-truck',move))).status,200);
  assert.equal((await current.GET(request('current'))).status,409,'Replacement truck requires test inspection');
  const back=await (await truckSwitch.GET(request('switch-truck',undefined,'?truck=Truck%206'))).json();assert.equal(back.preview.inspection.status,'ready','Same-day test truck inspection reused');
  await truckSwitch.POST(request('switch-truck',{action:'confirm',requestId:randomUUID(),to:'Truck 6',fingerprint:back.preview.fingerprint}));
  for(let i=1;i<=3;i++){
   const assignment=await (await current.GET(request('current'))).json();assert.equal(assignment.job.appointmentId,`TEST-${i}`);
   const fixture=await (await closeout.GET(request('closeout',undefined,`?assignmentId=${assignment.job.assignmentId}`))).json();assert.equal(fixture.dryRun,true);
   const body={assignmentId:assignment.job.assignmentId,requestId:randomUUID(),expectedVersion:fixture.jobVersion,crewVersion:fixture.crewVersion,values:{appointmentId:assignment.job.appointmentId,truck:'Truck 6',serviceDate:chicagoDateKey(),targetStatus:'8'},dryRun:false};
   const saved=await (await closeout.POST(request('closeout',body))).json();assert.equal(saved.receipt.dryRun,true,'Client cannot opt out of test isolation');
   const retry=await (await closeout.POST(request('closeout',body))).json();assert.deepEqual(retry,saved,'Retry does not finish another assignment');
   assert.deepEqual(await (await closeout.GET(request('closeout',undefined,`?assignmentId=${body.assignmentId}&requestId=${body.requestId}&reconcile=1`))).json(),saved);
  }
  assert.equal((await (await current.GET(request('current'))).json()).state,'waiting');
  await day.POST(request('day',{action:'reset-test-assignments'}));
  const reset=await (await current.GET(request('current'))).json();assert.equal(reset.job.appointmentId,'TEST-1');assert.notEqual(reset.job.assignmentId,first.job.assignmentId,'Reset gets fresh draft identities');
  assert.equal((await (await day.GET(request('day',undefined,'',legacyKey))).json()).day,null,'Test phones do not share setup');
  const paths=fs.readdirSync(path.join(root,'phones'));assert(!paths.includes('days'));assert(!fs.existsSync(path.join(root,'truck-inspections')));assert(!fs.existsSync(path.join(root,'crew-dispatch')));
  console.log('PASS: legacy test migration; all six API boundaries; setup/inspection gating; 3 sequential dummy assignments; same-day inspection reuse; isolated switch, simulated closeout, receipt recovery, reset; no provider calls or live stores.');
 }finally{globalThis.fetch=originalFetch;process.env=previous;fs.rmSync(root,{recursive:true,force:true});}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
