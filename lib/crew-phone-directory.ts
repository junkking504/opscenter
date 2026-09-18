import fs from 'node:fs';
import path from 'node:path';
import type { CrewPhoneDirectory } from './crew-phone';
import { JUNKWARE_DISPATCH_TRUCKS } from './junkware-trucks';

/** Private contacts are descriptive only; they never grant device or manager access. */
export function readCrewPhoneDirectory(): CrewPhoneDirectory {
  const root=process.env.OPS_CREW_PHONE_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'crew-phones');
  let value: {schema:number;company:CrewPhoneDirectory['company'];managers:CrewPhoneDirectory['managers']};
  try {value=JSON.parse(fs.readFileSync(path.join(root,'directory.json'),'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {company:[],managers:[]};throw error;}
  const name=(text:unknown)=>typeof text==='string' && text.trim().length>0 && text.length<=80;
  const number=(text:unknown)=>typeof text==='string' && /^[2-9][0-9]{2}-[2-9][0-9]{2}-[0-9]{4}$/.test(text);
  if(!value || value.schema!==1 || !Array.isArray(value.company) || !Array.isArray(value.managers)
    || value.company.length>50 || value.managers.length>50
    || value.company.some(row=>!row || !name(row.label) || !JUNKWARE_DISPATCH_TRUCKS.includes(row.truck) || !number(row.number))
    || value.managers.some(row=>!row || !name(row.name) || !number(row.number)))throw new Error('Invalid company-phone directory.');
  return {company:value.company.map(({label,truck,number})=>({label,truck,number})),managers:value.managers.map(({name,number})=>({name,number}))};
}
