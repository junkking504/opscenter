import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {defaultCostInputs,validCostInputs,type CostInputs,type CostRecord} from './appointment-cost-model';
export const APPOINTMENT_COST_ACTION={id:'schedule.appointment-cost.save',permission:'sensitive.write',authority:'opscenter_authoritative',risk:1,verifier:'immutable revision read-back'} as const;
export class AppointmentCostError extends Error {constructor(message:string,public status=400){super(message);}}
const root=()=>process.env.OPS_APPOINTMENT_COST_DIR||path.join(process.env.OPSCENTER_DATA_DIR||process.env.OPSBOT_DATA_DIR||path.join(process.env.HOME||'','.openclaw/workspace/opsbot/data'),'appointment-costs');
function directory(key:string){if(!key||key.length>300)throw new AppointmentCostError('Invalid appointment identity.');return path.join(root(),createHash('sha256').update(key).digest('hex'));}
export function readAppointmentCost(key:string,warehouse:CostInputs['warehouse']='NOHQ'):CostRecord{
 const dir=directory(key);let names:string[];
 try{names=fs.readdirSync(dir).filter(n=>/^\d+\.json$/.test(n)).sort((a,b)=>parseInt(a)-parseInt(b));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;names=[];}
 if(!names.length)return {version:0,inputs:{...defaultCostInputs,warehouse},actor:null,savedAt:null};
 const row=JSON.parse(fs.readFileSync(path.join(dir,names.at(-1)!),'utf8'));
 if(row.key!==key||row.version!==parseInt(names.at(-1)!)||!validCostInputs(row.inputs))throw new AppointmentCostError('Cost settings need recovery.',503);
 return {version:row.version,inputs:row.inputs,actor:row.actor,savedAt:row.savedAt};
}
export function saveAppointmentCost(key:string,expectedVersion:number,inputs:unknown,actor:string){
 if(!validCostInputs(inputs)||!actor||!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw new AppointmentCostError('Check the cost inputs. Fees plus margin must be below 100%.');
 if(readAppointmentCost(key).version!==expectedVersion)throw new AppointmentCostError('Cost assumptions changed. Reload before saving.',409);
 const dir=directory(key);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const row={key,version:expectedVersion+1,inputs,actor,savedAt:new Date().toISOString(),action:APPOINTMENT_COST_ACTION.id};
 const target=path.join(dir,`${row.version}.json`),temp=target+'.'+randomUUID()+'.tmp';
 const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(row));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.linkSync(temp,target);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new AppointmentCostError('Cost assumptions changed. Reload before saving.',409);throw e;}finally{fs.unlinkSync(temp);}
 const saved=readAppointmentCost(key);if(saved.version!==row.version||JSON.stringify(saved.inputs)!==JSON.stringify(inputs))throw new AppointmentCostError('Save could not be verified. Reload the saved assumptions.',503);
 return saved;
}
