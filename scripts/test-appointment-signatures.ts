import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {signatureSubmission} from '../lib/appointment-signature';
import {readAppointmentSignature,saveAppointmentSignature} from '../lib/crew-job-signatures';
import {crewSignatureRequest} from '../lib/crew-job-signature-http';
import {CREW_JOBS_PUBLIC_PATHS} from '../lib/crew-phone';
async function main(){
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'appointment-signature-'));
const previous={...process.env};process.env.OPSCENTER_DATA_DIR=dir;process.env.OPS_CREW_PHONE_DIR=path.join(dir,'phones');process.env.OPS_TRUCK_INSPECTION_DIR=path.join(dir,'inspections');
try {
 const scope={deviceId:randomUUID(),appointmentId:'900001',date:'2026-10-28',truck:'Truck 4'};
 const input={requestId:randomUUID(),assignmentId:randomUUID(),signerName:'Sample Signer',drawing:{strokes:[[[20,30],[70,70],[140,35]]]}};
 for(const drawing of [null,{strokes:[]},{strokes:[[[1,1]]]},{strokes:[[[1,1],[1,1],[1,1]]]},{strokes:[[[1,1],[700,5],[50,60]]]},{strokes:[Array.from({length:2001},()=>[10,10])]}])assert.throws(()=>signatureSubmission({...input,drawing}));
 for(const signerName of ['', ' ', '\u0000bad','x'.repeat(101)])assert.throws(()=>signatureSubmission({...input,signerName}));
 assert.throws(()=>signatureSubmission({...input,appointmentId:'another'}));
 assert.throws(()=>signatureSubmission({...input,signedAt:'2000-01-01'}));
 const saved=saveAppointmentSignature(input,scope);assert.equal(saved.signerName,input.signerName);assert.ok(Date.now()-Date.parse(saved.signedAt)<1000);
 assert.deepEqual(saveAppointmentSignature(input,scope),saved,'Repeated identical request has one immutable receipt');
 assert.deepEqual(readAppointmentSignature(scope.appointmentId,input.requestId),saved,'Lost save response recovers by a read');
 assert.deepEqual(readAppointmentSignature(scope.appointmentId),saved,'Latest appointment artifact is retrievable');
 assert.equal(readAppointmentSignature('900002',input.requestId),null,'Receipt cannot leak across appointments');
 assert.throws(()=>saveAppointmentSignature({...input,signerName:'Other'},scope),/different signature/);
 assert.throws(()=>saveAppointmentSignature(input,{...scope,deviceId:randomUUID()}),/different signature/);
 assert.throws(()=>readAppointmentSignature('../../private',input.requestId));
 const artifact=path.join(dir,'appointment-signatures',scope.appointmentId,`${input.requestId}.json`);
 assert.equal(fs.statSync(artifact).mode&0o777,0o600);
 assert.equal(Object.hasOwn(saved,'deviceId'),false);assert.equal(Object.hasOwn(saved,'hash'),false);
 const snapshot=fs.readFileSync(artifact,'utf8');
 const again=saveAppointmentSignature({...input,requestId:randomUUID(),signerName:'Sample signer again'},scope);assert.notEqual(again.requestId,saved.requestId);assert.equal(fs.readFileSync(artifact,'utf8'),snapshot,'Re-sign retains the original evidence');
 assert.equal(fs.readdirSync(path.dirname(artifact)).length,2,'Repeated requests do not create extra artifacts');
 const resolve=(()=>({phone:{deviceId:scope.deviceId,truck:scope.truck},current:{appointmentId:scope.appointmentId,date:scope.date},job:{readOnly:false}})) as Parameters<typeof crewSignatureRequest>[1];
 const request=(method:string,body?:unknown,origin='https://waypoint.junk-king.app')=>new Request(`https://waypoint.junk-king.app/api/crew-jobs/signatures?assignmentId=${input.assignmentId}&requestId=${input.requestId}`,{method,headers:{origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await crewSignatureRequest(request('GET'))).status,401,'Unauthenticated request fails existing phone gate');
 assert.equal((await crewSignatureRequest(request('POST',input,'https://other.example'),resolve)).status,403,'CSRF protection remains');
 assert.equal((await crewSignatureRequest(request('POST',{...input,drawing:{strokes:[]}}),resolve)).status,400);
 const readonly=(()=>({...resolve!(request('GET'),input.assignmentId),job:{readOnly:true}})) as Parameters<typeof crewSignatureRequest>[1];
 assert.equal((await crewSignatureRequest(request('POST',input),readonly)).status,403);
 assert.equal((await crewSignatureRequest(request('GET'),readonly)).status,403);
 assert.equal((await crewSignatureRequest(request('DELETE'),resolve)).status,405);
 const response=await crewSignatureRequest(request('GET'),resolve);assert.equal(response.status,200);assert.match(response.headers.get('cache-control')||'',/no-store/);assert.deepEqual((await response.json()).receipt,saved);
 const posted=await crewSignatureRequest(request('POST',input),resolve);assert.equal(posted.status,200);assert.deepEqual((await posted.json()).receipt,saved);
 assert.equal(fs.readdirSync(path.dirname(artifact)).length,2);
 assert.ok(CREW_JOBS_PUBLIC_PATHS.includes('/api/crew-jobs/signatures'),'Crew endpoint reaches its own existing authenticated handler');
 fs.writeFileSync(artifact,snapshot.replace('Sample Signer','Altered signer'));assert.throws(()=>readAppointmentSignature(scope.appointmentId,input.requestId),/needs attention/,'Corrupted evidence cannot be called verified');
 console.log('PASS optional signature validation, immutable/idempotent storage, lost-response recovery, re-sign history, private files, timestamp/audit binding, appointment scoping, CSRF/auth/view-only restrictions; synthetic temporary artifacts only.');
}finally{process.env=previous;fs.rmSync(dir,{recursive:true,force:true});}

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
