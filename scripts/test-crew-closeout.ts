import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-closeout-'));
 process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE=path.join(dir,'login-attempts.json');process.env.OPS_CREW_PHONE_DIR=path.join(dir,'phones');process.env.OPS_CREW_DISPATCH_DIR=path.join(dir,'dispatch');process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR=path.join(dir,'operations');process.env.JOB_ROUTE_ASSIGNMENTS_FILE=path.join(dir,'routes.json');
 try{
  const {createCrewPhoneEnrollment,enrollCrewPhone,revokeCrewPhone}=await import('../lib/crew-phone-store');
  const {saveCrewDay}=await import('../lib/crew-phone-day');
  const {chicagoDateKey}=await import('../lib/chicago-date');
  process.env.OPS_CREW_ROSTER_JSON=JSON.stringify(['Test Driver','Test Navigator','Extra Crew'].map((employee,index)=>({employee,username:`sample${index}`,active:true})));
  const {releaseCrewJob}=await import('../lib/crew-dispatch-store');
  const {CREW_PHONE_COOKIE}=await import('../lib/crew-phone');
  const {withCrewJob}=await import('../lib/crew-job-scope');
  const {loadCrewCloseout,submitCrewCloseout,checkCrewCloseout,crewReceiptProjection}=await import('../lib/crew-closeout-service');
  const {closeoutSourceVersion}=await import('../lib/desktop-closeout-contract');
  const {JunkwareCloseoutError}=await import('../lib/junkware-job-closeout');
  const token=randomBytes(32).toString('hex'),phone=enrollCrewPhone(createCrewPhoneEnrollment('Truck 6','Test phone','manager').code,token);
  const date=chicagoDateKey(),id='900001',version='a'.repeat(64),current=releaseCrewJob({truck:phone.truck,date,appointmentId:id,expectedVersion:0,requestId:randomUUID()},'manager').current!;
  saveCrewDay(phone,{date,requestId:randomUUID(),expectedVersion:0,responsible:'Test Driver',driver:'Test Driver',navigators:['Test Navigator']});
  const request=new Request('https://ops.example.invalid/api/crew-jobs/closeout',{headers:{Cookie:`${CREW_PHONE_COOKIE}=${token}`}});
  const job={appointmentId:id,recordId:`${date}:appointment:${id}`,version,truck:'Truck 6',status:'Confirmed',driver:'Test Driver',navigator:'Test Navigator'};
  const baseline={drivers:[{value:'d',label:'Test Driver'}],navigatorOptions:[{value:'n',label:'Test Navigator'},{value:'e',label:'Extra Crew'}],truck:'Truck 6',status:{value:'1',label:'Confirmed'},paymentMethods:[{value:'cash',label:'Cash'},{value:'card',label:'Credit Card'},{value:'billed',label:'Billed'}],payments:[{description:'Cash',amount:'50.00'}],photoEvidence:{appointmentId:id,urls:[`https://junkware.junk-king.com/system/aspnet/local/media/photo-${id}-before.jpg`]}};
  let source:Record<string,unknown>=structuredClone(baseline),writes=0,lose=false,revokeOnRead=false;
  const schedule=()=>({observedAt:new Date().toISOString(),appointments:[job]});
  const scopeSources={schedule,assignment:async()=>({appointmentId:id,truck:'Truck 6',date,status:'Confirmed'})};
  const deps:NonNullable<Parameters<typeof submitCrewCloseout>[2]>={schedule:schedule as unknown as NonNullable<Parameters<typeof submitCrewCloseout>[2]>['schedule'],scope:(req,assignmentId,run)=>withCrewJob(req,assignmentId,run,scopeSources as never),read:async()=>{if(revokeOnRead)revokeCrewPhone(phone.deviceId,'manager');return{ok:true,appointmentId:id,closeout:source};},
   write:async(_id,values)=>{assert.equal(values!.driverId,'d');assert.deepEqual(values!.navigatorIds,['n','e']);writes++;if(lose)throw new JunkwareCloseoutError('Lost result','uncertain');source={...source,status:{value:'8'},payments:[...baseline.payments,{description:'Credit Card 1234',amount:'350.00'}]};return{ok:true,appointmentId:id,closeout:source,verifiedAt:new Date().toISOString()};},updateLoad:()=>({updated:true,status:null,reason:"Synthetic source"}),
  };
  const values={driverId:'d',navigatorIds:['n','e'],appointmentId:id,serviceDate:date,targetStatus:'8',truck:'Truck 6',appointmentType:'Job',expectedSourceVersion:closeoutSourceVersion(source),addPayment:{methodId:'card',amount:'350.00',reference:'1234'}};
  const body=()=>({assignmentId:current.assignmentId,requestId:randomUUID(),expectedVersion:version,crewVersion:1,values:{...values,expectedSourceVersion:closeoutSourceVersion(source)}});
  assert.equal((await loadCrewCloseout(request,current.assignmentId,deps)).canWrite,true);
  await assert.rejects(submitCrewCloseout(request,{...body(),values:{...values,truck:'Truck 5'}},deps),/current appointment/);
  await assert.rejects(submitCrewCloseout(request,{...body(),values:{...values,targetStatus:'9'}},deps),/current appointment/);
  await assert.rejects(submitCrewCloseout(request,{...body(),appointmentId:'900002'},deps),/current closeout/);
  await assert.rejects(submitCrewCloseout(request,{...body(),values:{...values,addPayment:{methodId:'card',amount:'350.00',reference:'1234',cardNumber:'1234'}}},deps),/collected payment/);
  const invalid=await submitCrewCloseout(request,{...body(),values:{...values,addPayment:{methodId:'card',amount:'350',reference:'123'}}},deps);assert.equal(invalid.status,'failed');assert.equal(writes,0);
  const billed=await submitCrewCloseout(request,{...body(),values:{...values,addPayment:{methodId:'billed',amount:'350'}}},deps);assert.equal(billed.status,'failed');assert.equal(writes,0);
  source={...baseline,photoEvidence:{appointmentId:id,urls:[]}};
  assert.equal((await submitCrewCloseout(request,body(),deps)).status,'failed');assert.equal(writes,0);
  source=structuredClone(baseline);
  const stale=body();stale.values.expectedSourceVersion='b'.repeat(64);assert.equal((await submitCrewCloseout(request,stale,deps)).status,'failed');assert.equal(writes,0);
  assert.equal((await submitCrewCloseout(request,{...body(),crewVersion:0},deps)).status,'failed');
  assert.equal((await submitCrewCloseout(request,{...body(),values:{...values,navigatorIds:['e']}},deps)).status,'failed');assert.equal(writes,0,'Daily crew cannot be dropped and changed-day forms cannot write');
  assert.equal((await loadCrewCloseout(request,current.assignmentId,deps)).crewDefaults?.driver.value,'d');
  lose=true;const uncertain=body();assert.equal((await submitCrewCloseout(request,uncertain,deps)).status,'uncertain');assert.equal(writes,1);
  assert.equal((await submitCrewCloseout(request,uncertain,deps)).status,'uncertain');assert.equal(writes,1,'Same request is never replayed');
  await assert.rejects(submitCrewCloseout(request,body(),deps),/unverified change/);assert.equal(writes,1,'New UUID cannot bypass uncertainty');
  source={...baseline,payments:[...baseline.payments,{description:'Credit Card 1234',amount:'350.00'}]};
  assert.equal((await checkCrewCloseout(request,current.assignmentId,uncertain.requestId,true,deps)).status,'uncertain','Changed source cannot be declared not applied');assert.equal(writes,1);
  source=structuredClone(baseline);
  assert.equal((await checkCrewCloseout(request,current.assignmentId,uncertain.requestId,true,deps)).status,'failed','Only unchanged source can establish no save');assert.equal(writes,1);
  lose=false;const success=body();const receipt=await submitCrewCloseout(request,success,deps);assert.equal(receipt.status,'verified');assert.ok(receipt.createdAt);assert.equal(writes,2);
  assert.equal((await submitCrewCloseout(request,success,deps)).status,'verified');assert.equal(writes,2,'Verified request is never replayed');
  assert.equal((await checkCrewCloseout(request,current.assignmentId,success.requestId,false,deps)).status,'verified');
  await assert.rejects(checkCrewCloseout(request,randomUUID(),success.requestId,false,deps),/not found/);
  assert.equal(JSON.stringify(crewReceiptProjection(receipt)).includes('crewContext'),false);
  assert.equal((await loadCrewCloseout(request,current.assignmentId,deps)).canWrite,false,'Completed source cannot be charged again through the phone');
  assert.equal((await submitCrewCloseout(request,body(),deps)).status,'failed');assert.equal(writes,2);
  source=structuredClone(baseline);revokeOnRead=true;assert.equal((await submitCrewCloseout(request,body(),deps)).status,'failed');assert.equal(writes,2,'Revocation during source read prevents payment write');
  console.log('PASS: collected-payment authority, current-only scope, source/photo preflight, stale baseline, durable receipt identity, uncertain write lock, read-only recovery, completed-source denial and revocation. Synthetic sources only.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
