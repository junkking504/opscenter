import fs from 'node:fs';
import path from 'node:path';
import {writeCrewCloseoutReset} from '../lib/crew-closeout-reset';

const apply=process.argv.includes('--apply');
const ids=process.argv.slice(2).filter(value=>value!=='--apply');
if(!ids.length || ids.some(id=>!/^\d{1,12}$/.test(id)))throw new Error('Usage: node --import tsx scripts/reset-waypoint-closeouts.ts APPOINTMENT_ID [...] [--apply]');
const dataRoot=process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data');
const cacheRoot=path.join(dataRoot,'crew-closeout-cache');
const files=fs.readdirSync(cacheRoot).filter(name=>name.endsWith('.json'));
for(const appointmentId of ids){
  const matches=files.flatMap(name=>{try{const value=JSON.parse(fs.readFileSync(path.join(cacheRoot,name),'utf8'));return value?.scope?.appointmentId===appointmentId?[value]:[];}catch{return [];}})
    .sort((a,b)=>Date.parse(b.savedAt)-Date.parse(a.savedAt));
  const latest=matches[0];
  if(!latest)throw new Error(`No saved source read exists for appointment ${appointmentId}.`);
  if(latest.closeout?.status?.value!=='1' || (latest.closeout?.payments || []).length)throw new Error(`Appointment ${appointmentId} is not untouched in JunkWare; reset refused.`);
  const input={appointmentId,date:String(latest.scope.date),truck:String(latest.scope.truck),priorAssignmentId:String(latest.scope.assignmentId),actor:'operator-request'};
  if(!apply){console.log(JSON.stringify({apply:false,...input,status:latest.closeout.status.label,payments:latest.closeout.payments.length}));continue;}
  console.log(JSON.stringify({apply:true,...writeCrewCloseoutReset(input)}));
}
