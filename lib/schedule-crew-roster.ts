import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {crewDayRoster} from './crew-phone-day';
import {JUNKWARE_DISPATCH_TRUCKS} from './junkware-trucks';
export type RosterEntry={name:string;status:'scheduled'|'off'|'pending';truck:string;startTime:string};
export type DayRoster={date:string;version:number;entries:RosterEntry[];savedAt:string|null;actor:string|null};
export class RosterError extends Error {constructor(message:string,public status=400){super(message);}}
export function validRosterDate(date:string){return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;}
const root=()=>process.env.OPS_CREW_ROSTER_DIR||path.join(process.env.OPSCENTER_DATA_DIR||process.env.OPSBOT_DATA_DIR||path.join(process.cwd(),'data'),'schedule-crew-rosters');
function directory(date:string){if(!validRosterDate(date))throw new RosterError('Choose a valid roster date.');return path.join(root(),date);}
export function readScheduleCrewRoster(date:string):DayRoster {
 const dir=directory(date);
 let files:string[];
 try{files=fs.readdirSync(dir).filter(name=>/^\d+\.json$/.test(name)).sort((a,b)=>parseInt(a)-parseInt(b));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;files=[];}
 if(!files.length)return {date,version:0,entries:[],savedAt:null,actor:null};
 const value=JSON.parse(fs.readFileSync(path.join(dir,files.at(-1)!),'utf8')) as DayRoster;
 if(value.date!==date||value.version!==parseInt(files.at(-1)!)||!Array.isArray(value.entries))throw new Error('Roster storage needs recovery.');
 return value;
}
export function saveScheduleCrewRoster(date:string,expectedVersion:number,entries:unknown,actor:string,names=crewDayRoster()):DayRoster {
 const dir=directory(date);
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!actor.trim()||!Array.isArray(entries)||entries.length>100)throw new RosterError('Invalid roster request.');
 const seen=new Set<string>();
 const rows=entries.map((entry: RosterEntry)=>{
  if(!entry||!names.includes(entry.name)||seen.has(entry.name)||!['scheduled','off','pending'].includes(entry.status)||typeof entry.truck!=='string'||typeof entry.startTime!=='string')throw new RosterError('Choose each crew member once from the crew list.');
  seen.add(entry.name);
  if(entry.truck&&!JUNKWARE_DISPATCH_TRUCKS.includes(entry.truck))throw new RosterError('Choose a valid truck.');
  if(entry.startTime&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.startTime))throw new RosterError('Choose a valid start time.');
  if(entry.status==='scheduled'&&!entry.startTime)throw new RosterError('Set a start time for every scheduled crew member.');
  return {name:entry.name,status:entry.status,truck:entry.status==='scheduled'?entry.truck:'',startTime:entry.status==='scheduled'?entry.startTime:''};
 });
 if(readScheduleCrewRoster(date).version!==expectedVersion)throw new RosterError('Roster changed. Close and reopen it before saving.',409);
 const saved:DayRoster={date,version:expectedVersion+1,entries:rows,savedAt:new Date().toISOString(),actor};
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const file=path.join(dir,`${saved.version}.json`),temp=file+'.'+randomUUID()+'.tmp';
 const fd=fs.openSync(temp,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(saved));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.linkSync(temp,file);const parent=fs.openSync(dir,'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
 catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new RosterError('Roster changed. Close and reopen it before saving.',409);throw error;}finally{fs.unlinkSync(temp);}
 return readScheduleCrewRoster(date);
}
/** Explicit saved attendance only; do not infer attendance from jobs or phone enrollment. */
export function morningCrewRoster(date:string){const roster=readScheduleCrewRoster(date);return {...roster,entries:roster.entries.filter(row=>row.status==='scheduled')};}
