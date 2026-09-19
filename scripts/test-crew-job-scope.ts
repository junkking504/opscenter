import assert from 'node:assert/strict';
import {readyCrewInspection} from './fixtures/crew-ready';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-job-scope-'));
 process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE=path.join(dir,'login-attempts.json');process.env.OPS_CREW_PHONE_DIR=path.join(dir,'phones');process.env.OPS_TRUCK_INSPECTION_DIR=path.join(dir,'inspections');process.env.OPS_CREW_DISPATCH_DIR=path.join(dir,'dispatch');process.env.JOB_ROUTE_ASSIGNMENTS_FILE=path.join(dir,'routes.json');
 try{
  const {saveCrewDay}=await import('../lib/crew-phone-day');
  const {chicagoDateKey}=await import('../lib/chicago-date');
  process.env.OPS_CREW_ROSTER_JSON=JSON.stringify([{employee:'Test Driver',username:'test',active:true}]);
  const {withCrewJob}=await import('../lib/crew-job-scope');
  const {createCrewPhoneEnrollment,enrollCrewPhone,revokeCrewPhone}=await import('../lib/crew-phone-store');
  const {releaseCrewJob}=await import('../lib/crew-dispatch-store');
  const {CREW_PHONE_COOKIE}=await import('../lib/crew-phone');
  const token=randomBytes(32).toString('hex'),invite=createCrewPhoneEnrollment('Truck 6','Test company phone','test-manager');
  const phone=enrollCrewPhone(invite.code,token),date=chicagoDateKey();
  saveCrewDay(phone,{date,requestId:randomUUID(),expectedVersion:0,responsible:'Test Driver',driver:'Test Driver',navigators:[]});
  readyCrewInspection(phone);
  const state=releaseCrewJob({truck:'Truck 6',date,appointmentId:'900001',expectedVersion:0,requestId:randomUUID()},'test-manager');
  const current=state.current!;
  const request=new Request('https://ops.example.invalid/api/crew-jobs/photos',{headers:{Cookie:`${CREW_PHONE_COOKIE}=${token}`}});
  let calls=0,sourceTruck='Truck 6',sourceDate=date,observedAt:string|null=new Date().toISOString(),revokeDuringRead=false;
  const deps={
   schedule:()=>({observedAt,appointments:[{appointmentId:'900001',truck:'Truck 6'}]}),
   assignment:async()=>{if(revokeDuringRead)revokeCrewPhone(phone.deviceId,'manager');return{appointmentId:'900001',truck:sourceTruck,date:sourceDate,status:'Confirmed'};},
  } as unknown as NonNullable<Parameters<typeof withCrewJob>[3]>;
  const action=async()=>{calls++;return 'success';};
  await assert.rejects(withCrewJob(new Request(request.url),current.assignmentId,action,deps),/manager setup/);
  await assert.rejects(withCrewJob(request,randomUUID(),action,deps),/Dispatch changed/);
  sourceTruck='Truck 5';await assert.rejects(withCrewJob(request,current.assignmentId,action,deps),/no longer assigned/);sourceTruck='Truck 6';
  sourceDate='2020-01-01';await assert.rejects(withCrewJob(request,current.assignmentId,action,deps),/no longer assigned/);sourceDate=date;
  observedAt=null;await assert.rejects(withCrewJob(request,current.assignmentId,action,deps),/source is unavailable/);observedAt=new Date().toISOString();
  assert.equal(calls,0,'Invalid authority never calls source mutation');
  assert.equal(await withCrewJob(request,current.assignmentId,action,deps),'success');assert.equal(calls,1);
  revokeDuringRead=true;await assert.rejects(withCrewJob(request,current.assignmentId,action,deps),/manager setup/);assert.equal(calls,1,'Revocation during source lookup prevents mutation');
  console.log('PASS: current assignment only, truck/date source checks, stale source rejection, unauthorized access and mid-read revocation before mutation. Synthetic sources only.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
