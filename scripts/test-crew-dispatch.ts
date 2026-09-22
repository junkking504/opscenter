import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { advanceCrewDispatch, clearQueuedCrewJob, matchingCrewCompletion, readCrewDispatch, releaseCrewJob } from '../lib/crew-dispatch-store';
import { crewCurrentPayload, dispatchCrewJob, type CrewDispatchSources, type DispatchReceipt } from '../lib/crew-dispatch-service';
import { closeoutPhotoEvidence } from '../lib/closeout-photo-policy';
import type { CrewPhone } from '../lib/crew-phone';
import { publicAuthRoute } from '../lib/auth';
import { authorizeOpsRequest } from '../lib/ops-roles';

async function main(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-dispatch-test-'));
  process.env.OPS_CREW_DISPATCH_DIR=dir;
  try{
    const now=new Date(),date=now.toISOString().slice(0,10),truck='Truck 6';
    const version='a'.repeat(64);
    const jobs=[
      {appointmentId:'900001',version,truck,status:'Confirmed',jkNumber:'SAMPLE-01',customerName:'Current customer',address:'Current address',appointmentTime:'10 AM–12 PM',junkItems:['Garage cleanout'],appointmentNotes:['Side entrance'],driver:'Driver',navigator:'Navigator',futureMetadata:'NEVER DISCLOSE',financialData:'NEVER DISCLOSE'},
      {appointmentId:'900002',version,truck:'Truck# 6',status:'Confirmed',jkNumber:'SAMPLE-02',customerName:'FUTURE CUSTOMER',address:'FUTURE ADDRESS',appointmentTime:'1–3 PM',junkItems:[],appointmentNotes:[],driver:'Driver',navigator:'Navigator'},
    ];
    const phone:CrewPhone={deviceId:randomUUID(),truck,label:'Synthetic company phone',enrolledAt:now.toISOString(),expiresAt:new Date(now.getTime()+86400_000).toISOString()};
    let receipts:DispatchReceipt[]=[];
    let observedAt:string|null=now.toISOString();
    let sourceTruck=truck,sourceStatus='Confirmed',sourceDate=date,sourceUnavailable=false;
    let sourcePhotos=true;
    const sources:CrewDispatchSources={
      schedule:()=>({observedAt,appointments:jobs}),
      receipts:async()=>receipts,
      assignment:async id=>{if(sourceUnavailable)throw new Error('Source unavailable');return{appointmentId:id,truck:sourceTruck,date:sourceDate,status:sourceStatus};},
      closeout:async id=>{if(sourceUnavailable)throw new Error('Source unavailable');return{appointmentId:id,closeout:{truck:sourceTruck,status:{value:sourceStatus==='Completed'?'8':'1'},photoEvidence:closeoutPhotoEvidence(id,sourcePhotos?[`https://junkware.junk-king.com/system/aspnet/local/media/photo-${id}-test.jpg`]:[])}};},
    };
    assert.equal((await crewCurrentPayload(phone,sources)).state,'waiting');
    const first={truck,date,appointmentId:'900001',expectedVersion:0,expectedJobVersion:version,requestId:randomUUID()};
    observedAt=null;
    await assert.rejects(dispatchCrewJob(first,'manager',sources),/Refresh/);
    observedAt=new Date(now.getTime()-601_000).toISOString();
    await assert.rejects(dispatchCrewJob(first,'manager',sources),/Refresh/);
    observedAt=now.toISOString();sourceTruck='Truck 5';
    await assert.rejects(dispatchCrewJob(first,'manager',sources),/JunkWare/);
    sourceTruck=truck;sourceDate='2026-01-01';
    await assert.rejects(dispatchCrewJob(first,'manager',sources),/JunkWare/);
    sourceDate=date;sourceStatus='Completed';
    await assert.rejects(dispatchCrewJob(first,'manager',sources),/JunkWare/);
    sourceStatus='Confirmed';sourceTruck='Truck #6';
    jobs[0].truck='Truck# 6';
    const one=await dispatchCrewJob(first,'manager',sources);
    assert.equal(one.current?.appointmentId,'900001');
    assert.deepEqual(await dispatchCrewJob(first,'manager',sources),one,'Lost dispatch response reuses the same receipt');
    const second={...first,appointmentId:'900002',expectedVersion:1,requestId:randomUUID()};
    const two=await dispatchCrewJob(second,'manager',sources);
    assert.equal(two.current?.appointmentId,'900001');assert.equal(two.queued?.appointmentId,'900002');
    let payload=await crewCurrentPayload(phone,sources);
    assert.equal(payload.job?.appointmentId,'900001');
    for(const forbidden of ['FUTURE','900002','NEVER DISCLOSE','queued','version'])assert.equal(JSON.stringify(payload).includes(forbidden),false,forbidden);
    assert.throws(()=>releaseCrewJob({...second,requestId:randomUUID()},'manager'),/Dispatch changed/);
    assert.throws(()=>releaseCrewJob({...second,appointmentId:'900003',expectedVersion:2,requestId:randomUUID()},'manager'),/Remove the queued/);
    const receipt:DispatchReceipt={requestId:randomUUID(),action:'closeout',status:'verified',date,recordId:`${date}:appointment:900001`,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sourceResult:{appointmentId:'900001',closeout:{status:{value:'8'},photoEvidence:closeoutPhotoEvidence('900001',['https://junkware.junk-king.com/system/aspnet/local/media/photo-900001-test.jpg'])}}};
    for(const status of ['pending','failed','uncertain','reconciled']){
      receipts=[{...receipt,status}];payload=await crewCurrentPayload(phone,sources);
      assert.equal(payload.job?.appointmentId,'900001');
    }
    assert.equal(matchingCrewCompletion(two,{...receipt,updatedAt:new Date(Date.parse(two.current!.releasedAt)-1).toISOString()}),false,'A prior dispatch-cycle receipt cannot unlock this cycle');
    assert.equal(matchingCrewCompletion(two,{...receipt,date:'2020-01-01'}),false);
    assert.equal(matchingCrewCompletion(two,{...receipt,createdAt:undefined}),false,'Legacy receipts cannot prove this dispatch cycle');
    assert.equal(matchingCrewCompletion(two,{...receipt,createdAt:new Date(Date.parse(two.current!.releasedAt)-1).toISOString()}),false,'Updating an old receipt cannot unlock a new assignment');
    receipts=[receipt];
    assert.equal((await crewCurrentPayload(phone,sources)).state,'unavailable','Verified receipt with reopened source cannot advance');
    assert.equal(readCrewDispatch(truck).current?.appointmentId,'900001');
    sourceStatus='Completed';sourcePhotos=false;
    assert.equal((await crewCurrentPayload(phone,sources)).state,'unavailable','Source photos must still exist');
    sourcePhotos=true;sourceTruck='Truck 2';
    assert.equal((await crewCurrentPayload(phone,sources)).state,'unavailable','Wrong source truck cannot advance');
    sourceTruck='Truck #6';sourceUnavailable=true;
    await assert.rejects(crewCurrentPayload(phone,sources),/Source unavailable/);
    assert.equal(readCrewDispatch(truck).current?.appointmentId,'900001');
    sourceUnavailable=false;
    payload=await crewCurrentPayload(phone,sources);
    assert.equal(payload.job?.appointmentId,'900002');
    assert.equal(readCrewDispatch(truck).queued,null);
    receipts=[];sourceStatus='Confirmed';
    assert.equal((await crewCurrentPayload({...phone,truck:'Truck 3'},sources)).state,'waiting','Another enrolled truck cannot read these jobs');
    sourceTruck='Truck 3';
    assert.equal((await crewCurrentPayload(phone,sources)).state,'unavailable','Reassigned current job is withheld');
    sourceTruck=truck;observedAt=null;
    assert.equal((await crewCurrentPayload(phone,sources)).state,'unavailable');
    observedAt=now.toISOString();
    const current=readCrewDispatch(truck);
    const nextReceipt:DispatchReceipt={...receipt,requestId:randomUUID(),recordId:`${date}:appointment:900002`,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sourceResult:{appointmentId:'900002',closeout:{status:{value:'8'},photoEvidence:closeoutPhotoEvidence('900002',['https://junkware.junk-king.com/system/aspnet/local/media/photo-900002-test.jpg'])}}};
    sourceStatus='Completed';
    advanceCrewDispatch(current,nextReceipt,await sources.closeout('900002'));
    assert.equal((await crewCurrentPayload(phone,sources)).state,'waiting');
    const after=releaseCrewJob({...first,appointmentId:'900003',expectedVersion:4,requestId:randomUUID()},'manager');
    const queued=releaseCrewJob({...first,appointmentId:'900004',expectedVersion:after.version,requestId:randomUUID()},'manager');
    const cleared=clearQueuedCrewJob(truck,randomUUID(),queued.version,'manager');
    assert.equal(cleared.current?.appointmentId,'900003','Removing a queued job does not bypass current closeout');
    assert.equal(cleared.queued,null);
    fs.writeFileSync(path.join(dir,'Truck-6','2.json'),'{corrupt');
    assert.throws(()=>readCrewDispatch(truck),'Corrupt history must not become an empty queue');
    for(const route of ['/api/crew-jobs/current'])assert.equal(publicAuthRoute(route),true);
    for(const route of ['/crew-dispatch','/api/crew-dispatch']){
      assert.equal(publicAuthRoute(route),false);
      assert.equal(authorizeOpsRequest('operator',route,'GET').allowed,false);
      assert.equal(authorizeOpsRequest('manager',route,'POST').allowed,true);
    }
    console.log('PASS: truck-scoped release, fresh-source preflight, durable queue, stale-write rejection, no future-data response, receipt-cycle and source-photo completion gates, unavailable-source handling, revocation boundaries. Synthetic sources only.');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
