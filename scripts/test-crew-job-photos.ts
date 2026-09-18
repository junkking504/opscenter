import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {crewPhotoProjection,crewPhotos,parseCrewPhoto,readCrewPhoto,reconcileCrewPhoto,uploadCrewPhoto} from '../lib/crew-job-photos';
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-photo-test-'));process.env.OPS_CREW_PHOTO_DIR=dir;
 try{
  const scope={deviceId:randomUUID(),appointmentId:'900001'},assignmentId=randomUUID();
  const body={requestId:randomUUID(),assignmentId,category:'before',image:'data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,1,2,3]).toString('base64')};
  let writes=0;
  const uploader=async(file:string)=>{writes++;const hash=path.parse(file).name;assert.match(hash,/^[a-f0-9]{64}$/);return{mediaUrls:[`https://junkware.junk-king.com/system/aspnet/local/media/photo-900001-${hash}-Before.jpg`]};};
  const input=parseCrewPhoto(body),saved=await uploadCrewPhoto(input,scope,uploader);
  assert.equal(saved.status,'verified');assert.equal(writes,1);assert.deepEqual(readCrewPhoto(saved.requestId),saved);
  assert.deepEqual(await uploadCrewPhoto(input,scope,uploader),saved);assert.equal(writes,1,'Same request cannot repeat upload');
  assert.deepEqual(await uploadCrewPhoto({...input,requestId:randomUUID()},scope,uploader),saved);assert.equal(writes,1,'New request for identical photo cannot duplicate upload');
  await assert.rejects(uploadCrewPhoto({...input,category:'after'},scope,uploader),/another upload/);
  await assert.rejects(uploadCrewPhoto(input,{...scope,deviceId:randomUUID()},uploader),/another upload/);
  const uncertainInput={...input,requestId:randomUUID(),bytes:Buffer.from([255,216,255,225,4])};
  const uncertain=await uploadCrewPhoto(uncertainInput,scope,async()=>{writes++;throw new Error('Lost response after source upload');});
  assert.equal(uncertain.status,'uncertain');
  await uploadCrewPhoto(uncertainInput,scope,uploader);assert.equal(writes,2,'Uncertain upload never replays');
  assert.equal(reconcileCrewPhoto(uncertain,[]).status,'uncertain');
  assert.equal(reconcileCrewPhoto(uncertain,[`https://junkware.junk-king.com/system/aspnet/local/media/photo-900002-${uncertain.hash}-After.jpg`]).status,'uncertain');
  const recovered=reconcileCrewPhoto(uncertain,[`https://junkware.junk-king.com/system/aspnet/local/media/photo-900001-${uncertain.hash}-Before.jpg`]);
  assert.equal(recovered.status,'verified');assert.equal(writes,2,'Recovery reads only');
  assert.equal(crewPhotos(scope.deviceId,assignmentId).length,2);assert.equal(crewPhotos(randomUUID(),assignmentId).length,0);
  assert.equal(JSON.stringify(crewPhotoProjection(saved)).includes('deviceId'),false);
  assert.throws(()=>parseCrewPhoto({...body,appointmentId:'900002'}));
  assert.throws(()=>parseCrewPhoto({...body,image:'data:image/svg+xml;base64,PHN2Zz4='}));
  assert.throws(()=>parseCrewPhoto({...body,image:'data:image/jpeg;base64,YmFk'}));
  assert.throws(()=>parseCrewPhoto({...body,requestId:'../../private'}));
  const wrong=await uploadCrewPhoto({...input,requestId:randomUUID(),bytes:Buffer.from([255,216,255,4,5])},scope,async()=>({mediaUrls:['https://junkware.junk-king.com/system/aspnet/local/media/photo-900001-unrelated.jpg']}));
  assert.equal(wrong.status,'uncertain','Only this filename in the owning gallery counts');
  assert.equal(fs.readdirSync(dir).some(file=>file.endsWith('.jpg')),false,'Temporary source-upload media is removed');
  fs.writeFileSync(path.join(dir,`${saved.requestId}.json`),'{bad');assert.throws(()=>readCrewPhoto(saved.requestId));
  console.log('PASS: scoped photo receipts, exact-file source verification, no duplicate/replayed upload, lost-response read-back, invalid input and private projections. Synthetic uploads only.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
