import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {CrewPhoneError,type CrewPhoneDay} from './crew-phone';
import type {CrewDispatch} from './crew-dispatch';

export type TruckSwitch = {schema:1;requestId:string;deviceId:string;date:string;from:string;to:string;day:CrewPhoneDay;sourceDispatch:CrewDispatch;targetDispatch:CrewDispatch;fingerprint:string;createdAt:string;updatedAt:string;status:'moving'|'attention'|'complete';message:string;jobs:Array<{appointmentId:string;version:string;requestId:string;state:'pending'|'verified';start?:number;end?:number}>};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const root=()=>path.join(process.env.OPS_CREW_PHONE_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'crew-phones'),'truck-switches');
export function readTruckSwitch(id:string):TruckSwitch|null {
 if(!uuid.test(id))throw new CrewPhoneError('Invalid truck switch reference.');
 try {const value=JSON.parse(fs.readFileSync(path.join(root(),`${id}.json`),'utf8')) as TruckSwitch;if(value.schema!==1 || value.requestId!==id || !uuid.test(value.deviceId) || !Array.isArray(value.jobs) || !['moving','attention','complete'].includes(value.status))throw new Error('Truck switch history needs recovery.');return value;}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
}
export function truckSwitches():TruckSwitch[]{
 let names:string[];try{names=fs.readdirSync(root());}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
 return names.filter(n=>uuid.test(n.replace(/\.json$/,'')) && n.endsWith('.json')).map(n=>readTruckSwitch(n.slice(0,-5))!);
}
export function pendingTruckSwitch(deviceId:string){return truckSwitches().find(s=>s.deviceId===deviceId && s.status!=='complete') || null;}
export function assertTruckNotSwitching(truck:string,allowedId?:string){
 if(truckSwitches().some(s=>s.status!=='complete' && s.requestId!==allowedId && (s.from===truck || s.to===truck)))throw new CrewPhoneError('This truck switch is still being verified. Open Switch truck to check its progress.',409);
}
export function assertAppointmentNotSwitching(id:string,actor?:string){
 if(truckSwitches().some(s=>s.status!=='complete' && actor!==`waypoint-switch:${s.requestId}` && s.jobs.some(j=>j.appointmentId===id)))throw new CrewPhoneError('This appointment is part of a truck switch. Check the switch before changing this job.',409);
}
export function writeTruckSwitch(value:TruckSwitch){
 fs.mkdirSync(root(),{recursive:true,mode:0o700});const file=path.join(root(),`${value.requestId}.json`),temp=`${file}.${randomUUID()}.tmp`;
 const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temp,file);const dir=fs.openSync(root(),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 return value;
}
export function truckSwitchSummary(s:TruckSwitch){return {requestId:s.requestId,from:s.from,to:s.to,status:s.status,message:s.message,total:s.jobs.length,moved:s.jobs.filter(j=>j.state==='verified').length};}
