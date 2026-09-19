import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {createCrewPhoneEnrollment,enrollCrewPhone} from '../lib/crew-phone-store';
import {CREW_PHONE_COOKIE} from '../lib/crew-phone';
import {releaseCrewJob,readCrewDispatch,matchingCrewCompletion} from '../lib/crew-dispatch-store';
import {crewCheckoutDryRun} from '../lib/crew-checkout-dry-run';
import {submitCrewCloseout,crewCloseoutDependencies} from '../lib/crew-closeout-service';
import {POST as closeoutPost} from '../app/api/crew-jobs/closeout/route';
import {POST as photoPost} from '../app/api/crew-jobs/photos/route';
async function main(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-checkout-dry-run-'));
  process.env.OPS_CREW_PHONE_DIR=path.join(dir,'phones');process.env.OPS_CREW_DISPATCH_DIR=path.join(dir,'dispatch');process.env.OPS_CREW_CHECKOUT_DRY_RUN_FILE=path.join(dir,'policy.json');
  try{
    const token=randomBytes(32).toString('hex'),setup=createCrewPhoneEnrollment('Truck 6','Synthetic dry-run phone','test-manager');enrollCrewPhone(setup.code,token);
    const date=new Date().toISOString().slice(0,10),state=releaseCrewJob({truck:'Truck 6',requestId:randomUUID(),expectedVersion:0,appointmentId:'900002',date},'test-manager'),current=state.current!;
    const policy={schema:1,assignments:[{...current,truck:'Truck 6'}]};fs.writeFileSync(process.env.OPS_CREW_CHECKOUT_DRY_RUN_FILE,JSON.stringify(policy));
    assert.equal(crewCheckoutDryRun(current,'Truck 6'),true);
    assert.equal(crewCheckoutDryRun({...current,assignmentId:randomUUID()},'Truck 6'),false,'Policy applies only to the named assignment');
    assert.throws(()=>crewCheckoutDryRun(current,'Truck 9'),/does not match/);
    const origin='https://ops.example.invalid';
    const request=(route:string,body:unknown)=>new Request(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:CREW_PHONE_COOKIE+'='+token},body:JSON.stringify(body)});
    const body={requestId:randomUUID(),assignmentId:current.assignmentId,expectedVersion:'a'.repeat(64),crewVersion:1,dryRun:true,values:{expectedSourceVersion:'b'.repeat(64),appointmentId:current.appointmentId,truck:'Truck 6',serviceDate:date,targetStatus:'8',appointmentType:'Job',addPayment:{methodId:'cash',amount:'728'}}};
    crewCloseoutDependencies.write=async()=>{throw new Error('LIVE WRITE MUST NOT BE REACHED');};
    const response=await closeoutPost(request('/api/crew-jobs/closeout',body));const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
    assert.equal(result.receipt.dryRun,true);assert.equal(result.receipt.status,'reconciled');assert.equal(result.receipt.sourceResult,undefined);
    assert.match(result.receipt.message,/No customer receipt/);
    assert.equal(matchingCrewCompletion(state,{...result.receipt,date,recordId:date+':appointment:900002',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}),false,'Dummy completion never advances the truck queue');
    assert.deepEqual(readCrewDispatch('Truck 6'),state);
    await assert.rejects(submitCrewCloseout(request('/api/crew-jobs/closeout',body),body),/Live closeout writes are disabled/,'Direct service callers cannot bypass the route simulation');
    const photo=await photoPost(request('/api/crew-jobs/photos',{requestId:randomUUID(),assignmentId:current.assignmentId,category:'before',image:'data:image/jpeg;base64,/9j/'}));
    assert.equal(photo.status,409);assert.match((await photo.json()).error,/dry run/,'Photo endpoint rejects before source reads or uploads');
    fs.writeFileSync(process.env.OPS_CREW_CHECKOUT_DRY_RUN_FILE,'{invalid');assert.throws(()=>crewCheckoutDryRun(current,'Truck 6'),/could not be read/);
    fs.writeFileSync(process.env.OPS_CREW_CHECKOUT_DRY_RUN_FILE,JSON.stringify({schema:1,assignments:[]}));
    assert.equal((await closeoutPost(request('/api/crew-jobs/closeout',body))).status,409,'Stale dry-run UI cannot turn into a live save');
    console.log('PASS: exact-assignment dry run, photo POST blocked, no closeout writer/publisher, no completion receipt or queue advance, malformed policy and stale UI fail closed. Synthetic only.');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
