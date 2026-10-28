import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {CrewPhoneError} from './crew-phone';
import {signatureSubmission,signatureReceipt,signatureRequestId,type SignatureSubmission,type AppointmentSignature} from './appointment-signature';
type Scope={deviceId:string;appointmentId:string;date:string;truck:string};
type Stored=AppointmentSignature & Scope & {schema:1;assignmentId:string;hash:string};
const root=()=>path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'appointment-signatures');
function directory(appointmentId:string){if(!/^\d{1,12}$/.test(appointmentId))throw new CrewPhoneError('Appointment unavailable.',400);return path.join(root(),appointmentId);}
function file(appointmentId:string,id:string){if(!signatureRequestId.test(id))throw new CrewPhoneError('Signature request is invalid.',400);return path.join(directory(appointmentId),`${id}.json`);}
function read(appointmentId:string,id:string):Stored|null {
 try{
  const row=JSON.parse(fs.readFileSync(file(appointmentId,id),'utf8')) as Stored;
  signatureReceipt(row,appointmentId);
  if(row.schema!==1 || row.requestId!==id || !signatureRequestId.test(row.deviceId) || !signatureRequestId.test(row.assignmentId) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || typeof row.truck!=='string' || row.hash!==hash(row))throw Error('Signature evidence needs attention.');
  return row;
 }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
const hash=(row:SignatureSubmission & Scope)=>createHash('sha256').update(JSON.stringify([row.appointmentId,row.deviceId,row.assignmentId,row.date,row.truck,row.signerName,row.drawing])).digest('hex');
export function readAppointmentSignature(appointmentId:string,id?:string):AppointmentSignature|null {
 if(id){const row=read(appointmentId,id);return row?signatureReceipt(row,appointmentId):null;}
 let names:string[];try{names=fs.readdirSync(directory(appointmentId));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 const rows=names.filter(name=>name.endsWith('.json')&&signatureRequestId.test(name.slice(0,-5))).map(name=>read(appointmentId,name.slice(0,-5))!).filter(Boolean);
 rows.sort((a,b)=>b.signedAt.localeCompare(a.signedAt)||b.requestId.localeCompare(a.requestId));
 return rows[0]?signatureReceipt(rows[0],appointmentId):null;
}
/** Immutable private artifacts. No provider writes, signature replacement or closeout. */
export function saveAppointmentSignature(value:unknown,scope:Scope):AppointmentSignature {
 const input=signatureSubmission(value);
 if(!signatureRequestId.test(scope.deviceId) || !/^\d{4}-\d{2}-\d{2}$/.test(scope.date))throw new CrewPhoneError('Appointment access unavailable.',403);
 const digest=hash({...input,...scope});
 const prior=read(scope.appointmentId,input.requestId);
 if(prior){if(prior.hash!==digest)throw new CrewPhoneError('This request already belongs to a different signature.',409);return signatureReceipt(prior,scope.appointmentId);}
 const row:Stored={schema:1,...input,...scope,hash:digest,signedAt:new Date().toISOString()};
 const target=file(scope.appointmentId,input.requestId),dir=directory(scope.appointmentId);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const temp=`${target}.${randomUUID()}.tmp`,fd=fs.openSync(temp,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(row));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.linkSync(temp,target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const existing=read(scope.appointmentId,input.requestId);if(existing?.hash!==digest)throw new CrewPhoneError('This request already belongs to a different signature.',409);}finally{fs.unlinkSync(temp);}
 const handle=fs.openSync(dir,'r');try{fs.fsyncSync(handle);}finally{fs.closeSync(handle);}
 return signatureReceipt(read(scope.appointmentId,input.requestId),scope.appointmentId);
}
