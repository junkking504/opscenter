import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {readyCrewInspection} from './fixtures/crew-ready';
import {normalizeCustomerFields,customerFieldsMatch,verifyCustomerCorrection,type CustomerSource} from '../lib/crew-customer-contract';
const fields={firstName:'Alex',lastName:'Sample',phone:'5045550100',alternatePhone:'',email:'alex@example.invalid',serviceAddress:'100 Example St Unit 2',serviceZip:'70119',serviceContactName:'',serviceContactPhone:''};
async function main(){
  assert.equal(normalizeCustomerFields({...fields,phone:'(504) 555-0100'}).phone,fields.phone);
  for(const patch of [{firstName:''},{phone:'12'},{email:'not an email'},{serviceZip:'701'},{serviceAddress:'\nBad'},{truck:'Truck 9'},{addPayment:{}},{serviceZip:'70119-123'},{firstName:42}])assert.throws(()=>normalizeCustomerFields({...fields,...patch}));
  assert.ok(customerFieldsMatch(fields,{...fields,phone:'(504) 555-0100'}));
  const {applyCustomerCorrection}=await import('./junkware-customer-correction');
  const sourceBefore:CustomerSource={appointmentId:'100',fields:{...fields},sourceVersion:'a'.repeat(64),protectedVersion:'b'.repeat(64),status:'1',truck:'Truck 6',date:'2026-10-21',city:'Example',state:'LA'};
  let provider={...sourceBefore},staged={...sourceBefore},submitted=0,marked=0,reopened=0,loseResponse=false,alterProtected=false,retain=false;
  const page={url:()=> 'https://junkware.junk-king.com/franchise/appointment.aspx?id=100',goto:async()=>{reopened++;staged=provider;}} as never;
  const steps={capture:async()=>staged,stage:async(_page:unknown,_before:unknown,next:typeof fields)=>{staged={...sourceBefore,fields:next,protectedVersion:alterProtected?'c'.repeat(64):sourceBefore.protectedVersion};},submit:async()=>{submitted++;if(retain)provider=staged;if(loseResponse)throw Error('Navigation lost');}};
  const corrected={...fields,lastName:'Updated'};
  alterProtected=true;await assert.rejects(()=>applyCustomerCorrection(page,sourceBefore,corrected,()=>marked++,steps));assert.equal(submitted,0);assert.equal(marked,0,'Staging that changes schedule/financial fields cannot reach Save');alterProtected=false;
  retain=true;loseResponse=true;assert.equal((await applyCustomerCorrection(page,sourceBefore,corrected,()=>marked++,steps)).fields.lastName,'Updated');assert.equal(submitted,1);assert.equal(marked,1);assert.equal(reopened,1,'Lost Save response is followed by fresh source read, never a second submit');
  retain=false;provider=sourceBefore;await assert.rejects(()=>applyCustomerCorrection(page,sourceBefore,corrected,()=>marked++,steps));assert.equal(submitted,2);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'crew-customer-'));
  Object.assign(process.env,{OPSCENTER_LOGIN_RATE_LIMIT_FILE:path.join(root,'login.json'),OPS_CREW_PHONE_DIR:path.join(root,'phones'),OPS_TRUCK_INSPECTION_DIR:path.join(root,'inspections'),OPS_CREW_DISPATCH_DIR:path.join(root,'dispatch'),OPSCENTER_DESKTOP_OPERATIONS_DIR:path.join(root,'operations'),JOB_ROUTE_ASSIGNMENTS_FILE:path.join(root,'routes.json'),OPS_CREW_ROSTER_JSON:JSON.stringify([{employee:'Sample Driver',username:'sample',active:true}])});
  try{
    const {createCrewPhoneEnrollment,enrollCrewPhone,revokeCrewPhone}=await import('../lib/crew-phone-store');
    const {saveCrewDay,requireCrewDay}=await import('../lib/crew-phone-day');
    const {chicagoDateKey}=await import('../lib/chicago-date');
    const {releaseCrewJob}=await import('../lib/crew-dispatch-store');
    const {CREW_PHONE_COOKIE}=await import('../lib/crew-phone');
    const {withCrewJob}=await import('../lib/crew-job-scope');
    const {requireCrewReady}=await import('../lib/crew-phone-http');
    const {loadCrewCustomer,queueCrewCustomer,checkCrewCustomer}=await import('../lib/crew-customer-service');
    const {readScheduleReceipt,parseScheduleOperation,queueScheduleOperation}=await import('../lib/desktop-schedule-operations');
    const {CustomerCorrectionError}=await import('../lib/junkware-customer-correction');
    const token=randomBytes(32).toString('hex'),phone=enrollCrewPhone(createCrewPhoneEnrollment('Truck 6','Fixture phone','manager').code,token);
    const date=chicagoDateKey(),appointmentId='900001';
    const day=saveCrewDay(phone,{date,requestId:randomUUID(),expectedVersion:0,responsible:'Sample Driver',driver:'Sample Driver',navigators:[]});readyCrewInspection(phone);
    const current=releaseCrewJob({truck:phone.truck,date,appointmentId,expectedVersion:0,requestId:randomUUID()},'manager').current!;
    const request=new Request('https://waypoint.junk-king.app/api/crew-jobs/customer',{headers:{Cookie:`${CREW_PHONE_COOKIE}=${token}`}});
    const job={appointmentId,recordId:`${date}:appointment:${appointmentId}`,version:'a'.repeat(64),truck:'Truck 6',status:'Confirmed'};
    let source:CustomerSource={appointmentId,fields:{...fields},sourceVersion:'b'.repeat(64),protectedVersion:'c'.repeat(64),status:'1',truck:'Truck 6',date,city:'Example City',state:'LA'};
    let writes=0,lose=false,preflight=false,changed=false;
    const schedule=()=>({observedAt:new Date().toISOString(),appointments:[job]});
    const scopeSources={schedule,assignment:async()=>({appointmentId,truck:job.truck,date,status:job.status})};
    const deps:NonNullable<Parameters<typeof queueCrewCustomer>[2]>={
      local:(req,id)=>{const active=requireCrewReady(req);if(id!==current.assignmentId)throw Error('Assignment changed');return {phone:active,day:requireCrewDay(active),current,job:job as never};},
      scope:(req,id,run)=>withCrewJob(req,id,run,scopeSources as never),schedule:schedule as never,
      source:async(_id,input)=>{
        if(!input)return structuredClone(source);
        assert.equal(input.date,date);assert.equal(input.truck,'Truck 6');
        if(preflight)throw new CustomerCorrectionError('Reload source','preflight');
        writes++;
        source={...source,fields:input.fields,sourceVersion:(changed?'e':'d').repeat(64),...(changed?{protectedVersion:'e'.repeat(64)}:{})};
        if(lose)throw new CustomerCorrectionError('Lost response','uncertain');
        return source;
      }
    };
    const endpoint=await import('../app/api/crew-jobs/customer/route');
    assert.equal((await endpoint.GET(new Request('https://waypoint.junk-king.app/api/crew-jobs/customer'))).status,401);
    assert.equal((await endpoint.GET(new Request('https://waypoint.junk-king.app/api/crew-jobs/customer?appointmentId=other',{headers:request.headers}))).status,400);
    assert.equal((await endpoint.POST(new Request(request.url,{method:'POST',headers:{...Object.fromEntries(request.headers),'Origin':'https://other.example.invalid','Content-Type':'application/json'},body:'{}'}))).status,403);
    assert.equal((await endpoint.POST(new Request(request.url,{method:'POST',headers:{...Object.fromEntries(request.headers),'Origin':'https://waypoint.junk-king.app','Content-Type':'application/json'},body:JSON.stringify({appointmentId:'other'})}))).status,400);
    const body=()=>({assignmentId:current.assignmentId,requestId:randomUUID(),expectedVersion:job.version,expectedSourceVersion:source.sourceVersion,crewVersion:day.version,fields:{...fields,lastName:'Corrected'}});
    assert.equal((await loadCrewCustomer(request,current.assignmentId,deps)).canWrite,true);
    for(const patch of [{crewVersion:99},{fields:{...fields,price:'5'}},{expectedVersion:'bad'},{appointmentId:'123'},{assignmentId:'other'}])await assert.rejects(()=>queueCrewCustomer(request,{...body(),...patch},deps));
    const stale=await queueCrewCustomer(request,{...body(),expectedSourceVersion:'f'.repeat(64)},deps);assert.equal((await stale.run!()).status,'failed');assert.equal(writes,0);
    job.truck='Truck 9';await assert.rejects(()=>queueCrewCustomer(request,body(),deps));job.truck='Truck 6';
    job.status='Completed';await assert.rejects(()=>loadCrewCustomer(request,current.assignmentId,deps));job.status='Confirmed';
    preflight=true;const rejected=await queueCrewCustomer(request,body(),deps);assert.equal((await rejected.run!()).status,'failed');assert.equal(writes,0);preflight=false;
    const input=body(),queued=await queueCrewCustomer(request,input,deps);
    assert.equal(queued.receipt.status,'pending');
    const duplicate=await queueCrewCustomer(request,input,deps);assert.equal(duplicate.run,null);
    await assert.rejects(()=>queueCrewCustomer(request,body(),deps),/unverified change/);
    await assert.rejects(()=>queueScheduleOperation({requestId:randomUUID(),date,recordId:job.recordId,expectedVersion:job.version,action:'closeout',values:{}},'office',()=>job as never),/unverified change/);
    const receipt=await queued.run!();assert.equal(receipt.status,'verified');assert.equal(writes,1);
    assert.equal((await queueCrewCustomer(request,input,deps)).run,null,'Repeated save never writes again');
    assert.equal((await readScheduleReceipt(input.requestId))?.sourceResult?.customerCorrection!==undefined,true,'Durable before/expected and crew audit survive final receipt');
    assert.equal((await checkCrewCustomer(request,current.assignmentId,input.requestId,false,deps)).status,'verified');
    assert.throws(()=>parseScheduleOperation({...input,date,recordId:job.recordId,action:'customer_correction',values:{}}),'General office API does not accept crew correction action');
    lose=true;const lost=await queueCrewCustomer(request,body(),deps);assert.equal((await lost.run!()).status,'uncertain');
    assert.equal((await checkCrewCustomer(request,current.assignmentId,lost.receipt.requestId,true,deps)).status,'verified');assert.equal(writes,2,'Read-back does not replay');lose=false;
    const unchanged=await queueCrewCustomer(request,body(),{...deps,source:async(id,input)=>{if(input)throw new CustomerCorrectionError('Lost response','uncertain');return deps.source(id);}});assert.equal((await unchanged.run!()).status,'uncertain');
    // Use a genuinely different requested value so unchanged baseline proves no save.
    // Current value already matches the first request; exact intent is valid verification.
    assert.equal((await checkCrewCustomer(request,current.assignmentId,unchanged.receipt.requestId,true,deps)).status,'verified');
    const notSaved=await queueCrewCustomer(request,{...body(),fields:{...fields,lastName:'Not saved'}},{...deps,source:async(id,input)=>{if(input)throw new CustomerCorrectionError('Lost response','uncertain');return deps.source(id);}});await notSaved.run!();assert.equal((await checkCrewCustomer(request,current.assignmentId,notSaved.receipt.requestId,true,deps)).status,'uncertain','Fresh unknown save cannot be retried while a source request could still finish');const oldReceiptPath=path.join(root,'operations',notSaved.receipt.requestId+'.json');const oldReceipt=JSON.parse(fs.readFileSync(oldReceiptPath,'utf8'));oldReceipt.updatedAt=new Date(Date.now()-11*60_000).toISOString();fs.writeFileSync(oldReceiptPath,JSON.stringify(oldReceipt));assert.equal((await checkCrewCustomer(request,current.assignmentId,notSaved.receipt.requestId,true,deps)).status,'failed');
    changed=true;const altered=await queueCrewCustomer(request,body(),deps);assert.equal((await altered.run!()).status,'uncertain');assert.equal((await checkCrewCustomer(request,current.assignmentId,altered.receipt.requestId,true,deps)).status,'uncertain','Unrelated financial/source changes cannot be called success');
    assert.throws(()=>verifyCustomerCorrection(source,source.fields,'c'.repeat(64)));
    revokeCrewPhone(phone.deviceId,'fixture');await assert.rejects(()=>checkCrewCustomer(request,current.assignmentId,input.requestId,false,deps));
    console.log('Crew customer corrections: validation, scope, version conflicts, queued receipts, duplicate prevention, closeout interlock, lost response and read-only recovery passed.');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
