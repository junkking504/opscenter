import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CrewPhoneError } from './crew-phone';
import { closeoutPhotoEvidence } from './closeout-photo-policy';

export type CrewPhotoReceipt = { requestId:string; deviceId:string; assignmentId:string; appointmentId:string; category:'before'|'after'; hash:string; extension?:'jpg'|'png'; status:'pending'|'verified'|'uncertain'; createdAt:string; updatedAt:string; urls:string[] };
const root = () => process.env.OPS_CREW_PHOTO_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'crew-job-photos');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function file(id:string) { if(!uuid.test(id))throw new CrewPhoneError('A photo request reference is required.');return path.join(root(),`${id}.json`); }
function write(receipt:CrewPhotoReceipt, exclusive = false) {
  fs.mkdirSync(root(),{recursive:true,mode:0o700});
  const target=file(receipt.requestId),temp=`${target}.${randomUUID()}.tmp`;
  const fd=fs.openSync(temp,'wx',0o600);
  try {fs.writeFileSync(fd,JSON.stringify(receipt));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try {
    if(exclusive)fs.linkSync(temp,target);else fs.renameSync(temp,target);
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='EEXIST')throw new CrewPhoneError('This photo request is already being processed. Check saved photo.',409);
    throw error;
  }finally{fs.rmSync(temp,{force:true});}
  const dir=fs.openSync(root(),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
export function readCrewPhoto(id:string):CrewPhotoReceipt|null {
  try {
    let value=JSON.parse(fs.readFileSync(file(id),'utf8')) as CrewPhotoReceipt;
    if(value.requestId!==id || !uuid.test(value.deviceId) || !uuid.test(value.assignmentId) || !/^\d{1,12}$/.test(value.appointmentId) || !/^[a-f0-9]{64}$/.test(value.hash) || (value.extension!==undefined && !['jpg','png'].includes(value.extension)) || !['before','after'].includes(value.category) || !['pending','verified','uncertain'].includes(value.status) || !Array.isArray(value.urls))throw new Error('Photo receipt needs recovery.');
    if(value.status==='pending' && Date.now()-Date.parse(value.updatedAt)>10*60_000){
      value={...value,status:'uncertain',updatedAt:new Date().toISOString()};
      write(value);
    }
    return value;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
export function crewPhotos(deviceId:string,assignmentId:string) {
  let names:string[];try{names=fs.readdirSync(root());}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  return names.filter(name=>uuid.test(name.slice(0,-5)) && name.endsWith('.json')).map(name=>readCrewPhoto(name.slice(0,-5))!).filter(row=>row.deviceId===deviceId && row.assignmentId===assignmentId);
}
export function crewPhotoProjection(row:CrewPhotoReceipt) {return {requestId:row.requestId,category:row.category,status:row.status,updatedAt:row.updatedAt};}
export function parseCrewPhoto(body:Record<string,unknown>) {
  if(!uuid.test(String(body.requestId)) || !uuid.test(String(body.assignmentId)) || !['before','after'].includes(String(body.category)) || typeof body.image!=='string'
    || Object.keys(body).some(key=>!['requestId','assignmentId','category','image'].includes(key)))throw new CrewPhoneError('Choose a photo for the current assignment.');
  const match=/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.image);
  if(!match)throw new CrewPhoneError('Choose a JPEG or PNG photo.');
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length===0 || bytes.length>4*1024*1024)throw new CrewPhoneError('Choose a photo smaller than 4 MB.',413);
  const valid=match[1]==='jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 : bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(!valid)throw new CrewPhoneError('The photo could not be read. Choose a JPEG or PNG photo.');
  return {requestId:String(body.requestId),assignmentId:String(body.assignmentId),category:body.category as 'before'|'after',bytes,extension:match[1]==='jpeg'?'jpg':'png'};
}
/** Store the phone transfer durably before any slow JunkWare work begins. */
export function stageCrewPhoto(input:ReturnType<typeof parseCrewPhoto>,scope:{deviceId:string;appointmentId:string}) {
  const hash=createHash('sha256').update(scope.appointmentId).update(input.assignmentId).update(input.bytes).digest('hex');
  const prior=readCrewPhoto(input.requestId);
  if(prior){
    if(prior.deviceId!==scope.deviceId || prior.assignmentId!==input.assignmentId || prior.appointmentId!==scope.appointmentId || prior.category!==input.category || prior.hash!==hash)throw new CrewPhoneError('This photo request belongs to another upload.',409);
    return {receipt:prior,created:false};
  }
  const duplicate=crewPhotos(scope.deviceId,input.assignmentId).find(row=>row.hash===hash);
  if(duplicate)return {receipt:duplicate,created:false};
  const at=new Date().toISOString();
  const receipt:CrewPhotoReceipt={...scope,requestId:input.requestId,assignmentId:input.assignmentId,category:input.category,hash,extension:input.extension as 'jpg'|'png',status:'pending',createdAt:at,updatedAt:at,urls:[]};
  const media=path.join(root(),`${hash}.${input.extension}`);
  fs.mkdirSync(root(),{recursive:true,mode:0o700});
  const temporary=`${media}.${randomUUID()}.tmp`;
  const descriptor=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(descriptor,input.bytes);fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
  fs.renameSync(temporary,media);
  try{write(receipt,true);}catch(error){fs.rmSync(media,{force:true});throw error;}
  return {receipt,created:true};
}

/** Caller holds the appointment lock. A pending staged photo is attempted once;
 * uncertain and verified receipts are never replayed. */
export async function processStagedCrewPhoto(requestId:string,upload:(file:string)=>Promise<{mediaUrls:string[]}>) {
  let receipt=readCrewPhoto(requestId);
  if(!receipt)throw new CrewPhoneError('Photo receipt not found.',404);
  if(receipt.status!=='pending')return receipt;
  const extension=receipt.extension || (fs.existsSync(path.join(root(),`${receipt.hash}.jpg`))?'jpg':fs.existsSync(path.join(root(),`${receipt.hash}.png`))?'png':null);
  const media=extension?path.join(root(),`${receipt.hash}.${extension}`):'';
  if(!media || !fs.existsSync(media)){
    receipt={...receipt,status:'uncertain',updatedAt:new Date().toISOString()};write(receipt);return receipt;
  }
  const staged=receipt;
  try {
    const result=await upload(media);
    const urls=closeoutPhotoEvidence(staged.appointmentId,result.mediaUrls).urls.filter(url=>url.includes(`-${staged.hash}-`) || new URL(url).pathname.endsWith(`-${staged.hash}.${extension}`));
    receipt={...staged,status:urls.length===1?'verified':'uncertain',urls,updatedAt:new Date().toISOString()};
  }catch {receipt={...staged,status:'uncertain',updatedAt:new Date().toISOString()};}
  finally {fs.rmSync(media,{force:true});}
  write(receipt);return receipt;
}

/** Compatibility wrapper for synchronous callers and focused tests. */
export async function uploadCrewPhoto(input:ReturnType<typeof parseCrewPhoto>,scope:{deviceId:string;appointmentId:string},upload:(file:string)=>Promise<{mediaUrls:string[]}>) {
  const staged=stageCrewPhoto(input,scope);
  return staged.created?processStagedCrewPhoto(staged.receipt.requestId,upload):staged.receipt;
}

export async function waitForCrewPhotos(deviceId:string,assignmentId:string,appointmentId:string,requestIds:string[],timeoutMs=10*60_000) {
  const unique=[...new Set(requestIds)];
  const deadline=Date.now()+timeoutMs;
  while(true){
    const receipts=unique.map(id=>readCrewPhoto(id));
    if(receipts.some(receipt=>!receipt || receipt.deviceId!==deviceId || receipt.assignmentId!==assignmentId || receipt.appointmentId!==appointmentId))throw new CrewPhoneError('One or more checkout photos do not belong to this assignment.',409);
    if(receipts.some(receipt=>receipt?.status==='uncertain'))throw new CrewPhoneError('A photo result needs verification. Check the saved photo before another checkout.',409);
    if(receipts.every(receipt=>receipt?.status==='verified'))return receipts as CrewPhotoReceipt[];
    if(Date.now()>=deadline)throw new Error('Photo processing did not finish before the checkout worker timed out.');
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
/** A GET may verify a saved filename, but never upload again. Absence remains uncertain. */
export function reconcileCrewPhoto(receipt:CrewPhotoReceipt,urls:string[]) {
  const matching=closeoutPhotoEvidence(receipt.appointmentId,urls).urls.filter(url=>{
    const stem=path.parse(new URL(url).pathname).name;return stem.includes(`-${receipt.hash}-`) || stem.endsWith(`-${receipt.hash}`);
  });
  if(matching.length!==1)return receipt;
  const result={...receipt,status:'verified' as const,urls:matching,updatedAt:new Date().toISOString()};write(result);return result;
}
