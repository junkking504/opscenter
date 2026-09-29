import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createCrewPhoneEnrollment,enrollCrewPhone} from '../lib/crew-phone-store';
import {CREW_PHONE_COOKIE} from '../lib/crew-phone';
import {releaseCrewJob} from '../lib/crew-dispatch-store';
import {simulateCrewCloseout} from '../lib/crew-closeout-service';

async function main(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-closeout-live-scope-'));
  process.env.OPS_CREW_PHONE_DIR=path.join(dir,'phones');
  process.env.OPS_CREW_DISPATCH_DIR=path.join(dir,'dispatch');
  process.env.OPS_CREW_CHECKOUT_DRY_RUN_FILE=path.join(dir,'policy.json');
  try{
    const token=randomBytes(32).toString('hex');
    const setup=createCrewPhoneEnrollment('Truck 9','Synthetic live-scope phone','test-manager');
    enrollCrewPhone(setup.code,token);
    const date=new Date().toISOString().slice(0,10);
    const state=releaseCrewJob({truck:'Truck 9',requestId:randomUUID(),expectedVersion:0,appointmentId:'900001',date},'test-manager');
    const origin='https://ops.example.invalid';
    const request=(body:unknown)=>new Request(origin+'/api/crew-jobs/closeout',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:CREW_PHONE_COOKIE+'='+token},body:JSON.stringify(body)});
    const liveBody={requestId:randomUUID(),assignmentId:randomUUID(),expectedVersion:'a'.repeat(64),crewVersion:1,values:{expectedSourceVersion:'b'.repeat(64),appointmentId:'900002',truck:'Truck 9',serviceDate:date,targetStatus:'8',appointmentType:'Job',addPayment:{methodId:'cash',amount:'728'}}};
    assert.notEqual(liveBody.assignmentId,state.current?.assignmentId,'Fixture must represent a schedule-derived non-current appointment');
    assert.equal(await simulateCrewCloseout(request(liveBody),liveBody),null,'Live truck-day appointments must continue to authoritative queue scope validation');
    await assert.rejects(simulateCrewCloseout(request({...liveBody,dryRun:true}),{...liveBody,dryRun:true}),/Dry-run protection changed/,'Dry-run submissions remain locked to the exact current assignment');
    console.log('PASS: live non-current truck-day closeout reaches authoritative scope; dry-run remains fail-closed. Synthetic only.');
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
