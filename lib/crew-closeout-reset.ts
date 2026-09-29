import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sameTruck,truckNumber} from './junkware-trucks';

export type CrewCloseoutReset={appointmentId:string;date:string;truck:string;priorAssignmentId:string;token:string;resetAt:string;actor:string};
type ResetFile={schema:1;resets:CrewCloseoutReset[]};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const root=()=>process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data');
const target=()=>path.join(root(),'crew-closeout-resets.json');
const valid=(row:CrewCloseoutReset)=>Boolean(row && /^\d{1,12}$/.test(row.appointmentId) && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
  && truckNumber(row.truck)!==null && uuid.test(row.priorAssignmentId) && uuid.test(row.token) && Number.isFinite(Date.parse(row.resetAt)) && row.actor);
export function readCrewCloseoutResets():CrewCloseoutReset[] {
  try{
    const value=JSON.parse(fs.readFileSync(target(),'utf8')) as ResetFile;
    if(value.schema!==1 || !Array.isArray(value.resets) || value.resets.some(row=>!valid(row)))throw new Error('Waypoint closeout reset registry needs review.');
    return value.resets;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
}
export function crewCloseoutReset(truck:string,date:string,appointmentId:string) {
  return readCrewCloseoutResets().find(row=>row.date===date && row.appointmentId===appointmentId && sameTruck(row.truck,truck)) || null;
}
export function writeCrewCloseoutReset(input:Omit<CrewCloseoutReset,'token'|'resetAt'>,now=new Date()) {
  const value:CrewCloseoutReset={...input,token:randomUUID(),resetAt:now.toISOString()};
  if(!valid(value))throw new Error('A valid appointment, truck, date and prior assignment are required.');
  const prior=readCrewCloseoutResets().filter(row=>!(row.date===value.date && row.appointmentId===value.appointmentId && sameTruck(row.truck,value.truck)));
  const body:ResetFile={schema:1,resets:[...prior,value]};
  fs.mkdirSync(root(),{recursive:true,mode:0o700});
  const temporary=`${target()}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary,JSON.stringify(body),{mode:0o600});
  fs.renameSync(temporary,target());
  return value;
}
