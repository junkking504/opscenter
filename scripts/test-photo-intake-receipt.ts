import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {GET} from '../app/api/crew-jobs/photos/route';
import {stageCrewPhoto} from '../lib/crew-job-photos';
import {createCrewPhoneEnrollment,enrollCrewPhone,revokeCrewPhone} from '../lib/crew-phone-store';
import {CREW_PHONE_COOKIE} from '../lib/crew-phone';

async function main(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'photo-intake-receipt-'));
  process.env.OPS_CREW_PHONE_DIR=path.join(directory,'phones');
  process.env.OPS_CREW_PHOTO_DIR=path.join(directory,'photos');
  try{
    const token=randomBytes(32).toString('hex');
    const invitation=createCrewPhoneEnrollment('Truck 6','Synthetic receipt phone','test-manager');
    const phone=enrollCrewPhone(invitation.code,token),assignmentId=randomUUID();
    const receipt=stageCrewPhoto({requestId:randomUUID(),assignmentId,category:'after',extension:'jpg',bytes:Buffer.from([255,216,255,224,0,1,2,3])},{deviceId:phone.deviceId,appointmentId:'900001'}).receipt;
    const read=(assignment=assignmentId,id=receipt.requestId,authenticated=true)=>GET(new Request(`https://ops.example.invalid/api/crew-jobs/photos?receiptOnly=1&assignmentId=${assignment}&requestId=${id}`,{headers:authenticated?{Cookie:`${CREW_PHONE_COOKIE}=${token}`}:{}}));
    // No schedule, assignment release, provider session or network is required
    // to recover the phone's own durable intake acknowledgment.
    const response=await read();assert.equal(response.status,200);
    assert.deepEqual((await response.json()).receipt,{requestId:receipt.requestId,category:'after',status:'pending',updatedAt:receipt.updatedAt});
    assert.equal((await read(randomUUID())).status,404,'Other assignments cannot read this receipt');
    const other=stageCrewPhoto({requestId:randomUUID(),assignmentId,category:'after',extension:'jpg',bytes:Buffer.from([255,216,255,224,4,5])},{deviceId:randomUUID(),appointmentId:'900001'}).receipt;
    assert.equal((await read(assignmentId,other.requestId)).status,404,'Other phones cannot read this receipt');
    assert.equal((await read(assignmentId,receipt.requestId,false)).status,401);
    revokeCrewPhone(phone.deviceId,'test-manager');assert.equal((await read()).status,401);
    console.log('PASS: fast photo intake acknowledgment, private projection, phone/assignment isolation and revoked access. Synthetic only.');
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
