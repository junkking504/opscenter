import {assertTruckNotSwitching} from './crew-truck-switch-store';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {JUNKWARE_DISPATCH_TRUCKS} from './junkware-trucks';
import {crewRoster} from './crew-auth';
import {chicagoDateKey} from './chicago-date';
import {CrewPhoneError,type CrewPhone,type CrewPhoneDay} from './crew-phone';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function crewDayRoster() {return [...new Set(crewRoster().filter(row=>row.active).map(row=>row.employee))].sort((a,b)=>a.localeCompare(b));}
function directory(phone:CrewPhone,date:string) {
 if(!uuid.test(phone.deviceId) || !/^\d{4}-\d{2}-\d{2}$/.test(date))throw new CrewPhoneError('Invalid phone day.');
 const root=process.env.OPS_CREW_PHONE_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'crew-phones');
 return path.join(root,'days',phone.deviceId,date);
}
function history(phone:CrewPhone,date:string):CrewPhoneDay[] {
 const dir=directory(phone,date);let names:string[];
 try {names=fs.readdirSync(dir).filter(name=>/^\d+\.json$/.test(name)).sort((a,b)=>parseInt(a)-parseInt(b));}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
 return names.map((name,index)=>{
  const row=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')) as CrewPhoneDay;
  if(row.deviceId!==phone.deviceId || !JUNKWARE_DISPATCH_TRUCKS.includes(row.truck) || row.date!==date || row.version!==index+1 || parseInt(name)!==index+1 || !uuid.test(row.requestId) || typeof row.driver!=='string' || !row.driver || typeof row.responsible!=='string' || !row.responsible || !Array.isArray(row.navigators) || row.navigators.some(n=>typeof n!=='string' || !n) || new Set([row.driver,...row.navigators]).size!==1+row.navigators.length || !Number.isFinite(Date.parse(row.savedAt)))throw new Error('Daily crew history needs recovery.');
  return row;
 });
}
export function readCrewDay(phone:CrewPhone,date=chicagoDateKey()) {return history(phone,date).at(-1) || null;}
export function requireCrewDay(phone:CrewPhone,date=chicagoDateKey()) {
 const day=readCrewDay(phone,date);
 if(date!==chicagoDateKey() || !day)throw new CrewPhoneError('Set up today’s driver and navigator on this phone first.',409);
 const roster=crewDayRoster();
 if([day.responsible,day.driver,...day.navigators].some(name=>!roster.includes(name)))throw new CrewPhoneError('The crew list changed. Review today’s crew on this phone.',409);
 return day;
}
export function saveCrewDay(phone:CrewPhone,body:Record<string,unknown>,now=new Date(),roster=crewDayRoster(),switchId?:string):CrewPhoneDay {
 assertTruckNotSwitching(phone.truck,switchId);
 const date=chicagoDateKey(now);
 if(Object.keys(body).some(key=>!['date','requestId','expectedVersion','responsible','driver','navigators','truck'].includes(key)) || body.date!==date || !uuid.test(String(body.requestId)) || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion)<0)throw new CrewPhoneError('Refresh today’s crew before saving.',409);
 const truck=body.truck===undefined?phone.truck:body.truck;
 if(typeof truck!=='string' || !JUNKWARE_DISPATCH_TRUCKS.includes(truck))throw new CrewPhoneError('Choose the truck assigned to you today.');
 assertTruckNotSwitching(truck,switchId);
 const {driver,responsible,navigators}=body;
 if(typeof driver!=='string' || typeof responsible!=='string' || !Array.isArray(navigators) || navigators.length>5 || [driver,responsible,...navigators].some(name=>typeof name!=='string' || !roster.includes(name)))throw new CrewPhoneError('Choose the responsible person, driver and navigator from the crew list.');
 if(new Set([driver,...navigators]).size!==1+navigators.length)throw new CrewPhoneError('Each person can have only one position.');
 const rows=history(phone,date),latest=rows.at(-1);
 const prior=rows.find(row=>row.requestId===body.requestId);
 if(prior){if(prior.truck!==truck || prior.driver!==driver || prior.responsible!==responsible || JSON.stringify(prior.navigators)!==JSON.stringify(navigators))throw new CrewPhoneError('This crew setup request was already used.',409);return latest!;}
 if((latest?.version || 0)!==body.expectedVersion)throw new CrewPhoneError('Today’s crew changed. Refresh before saving.',409);
 const row:CrewPhoneDay={deviceId:phone.deviceId,truck,date,version:Number(body.expectedVersion)+1,requestId:String(body.requestId),responsible,driver,navigators,savedAt:now.toISOString()};
 const dir=directory(phone,date);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const file=path.join(dir,`${row.version}.json`),temp=`${file}.${randomUUID()}.tmp`;
 const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(row));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.linkSync(temp,file);const parent=fs.openSync(dir,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const saved=readCrewDay(phone,date);if(saved?.requestId!==row.requestId || saved.truck!==row.truck || saved.driver!==row.driver || saved.responsible!==row.responsible || JSON.stringify(saved.navigators)!==JSON.stringify(row.navigators))throw new CrewPhoneError('Today’s crew changed. Refresh before saving.',409);}
 finally{fs.unlinkSync(temp);}
 return readCrewDay(phone,date)!;
}
type Option={value:string;label:string};
const nameKey=(name:string)=>{const parts=name.trim().split(',').map(s=>s.trim());return (parts.length===2?`${parts[1]} ${parts[0]}`:name).replace(/\s+/g,' ').trim().toLowerCase();};
export function closeoutCrewDefaults(day:CrewPhoneDay,source:Record<string,unknown>) {
 const match=(name:string,options:unknown):Option=>{
  const matches=Array.isArray(options)?options.filter((row:Option)=>row && typeof row.value==='string' && row.value && typeof row.label==='string' && nameKey(row.label)===nameKey(name)):[];
  if(matches.length!==1)throw new CrewPhoneError(`JunkWare could not uniquely match ${name}. Ask the office to check the crew list.`,409);
  return {value:matches[0].value,label:matches[0].label};
 };
 return {version:day.version,driver:match(day.driver,source.drivers),navigators:day.navigators.map(name=>match(name,source.navigatorOptions))};
}
