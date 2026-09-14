import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {chicagoDateKey} from './chicago-date';
import {readJobRows,junkwareScheduleUpdatedAt} from './desktop-schedule-source';
import {readScheduleVisits} from './desktop-schedule-visits';
import {physicalCloseoutTruck} from './truck-load-closeouts';
import {junkwareJobLoadFraction,normalizeTruckLoadLabel,formatLoadAmount} from './truck-load-status';
import {addJunkwareAppointmentNote} from './junkware-appointment-note';
import {withJunkwareAppointmentSyncLock,withJobRouteAssignmentSyncLock} from './job-route-assignments';

type Candidate = {key:string;date:string;appointmentId:string;note:string};
type PickupJob = Pick<ReturnType<typeof readJobRows>[number],'appointmentId'|'jkNumber'|'truck'|'status'|'appointmentType'|'closeout'|'chargeDetailsPending'|'appointmentNotes'|'closeoutObservedAt'>;
type Receipt = Candidate & {status:'writing'|'verified'|'uncertain';updatedAt:string;actor:string};
const directory = () => path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'fleet','pickup-source-notes');
const fileFor = (key:string) => path.join(directory(),`${key}.json`);
const save = (receipt:Receipt) => {
  const file=fileFor(receipt.key), temporary=`${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary,JSON.stringify(receipt),{mode:0o600});
  fs.renameSync(temporary,file);
};

export function pickupSourceNoteCandidates(date:string,jobs:PickupJob[],visits:ReturnType<typeof readScheduleVisits>['visits']):Candidate[] {
  const result:Candidate[]=[];
  const byId=new Map<string,typeof jobs>();
  for(const job of jobs) byId.set(job.appointmentId,[...(byId.get(job.appointmentId)||[]),job]);
  for(const [id,copies] of byId) {
    const job=copies[0];
    if(!/^\d{1,12}$/.test(id) || copies.some(copy=>JSON.stringify([copy.truck,copy.status,copy.appointmentType,copy.closeout])!==JSON.stringify([job.truck,job.status,job.appointmentType,job.closeout]))) continue;
    if(!/^job$/i.test(job.appointmentType) || !/^(completed|closed)\b/i.test(job.status) || job.chargeDetailsPending || !job.closeout) continue;
    const carrier=physicalCloseoutTruck(date,job,visits);
    const assigned=normalizeTruckLoadLabel(job.truck);
    const fraction=junkwareJobLoadFraction(job.closeout.loadSize,job.closeout.loadQuantity);
    if(!carrier || carrier.truck===assigned || fraction===null || fraction<=0) continue;
    const truck=carrier.truck.replace('#','');
    const marker=`OpsCenter pickup ${date}/${id}/${truck.replace(' ','')}`;
    // One evidence note per appointment/carrier; later polling cannot spam notes.
    if(job.appointmentNotes.some(note=>note.includes(marker))) continue;
    const clock=(stamp:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(stamp));
    const note=`${marker}: GPS confirms ${truck} arrived ${clock(carrier.visit.arrival!)} and departed ${clock(carrier.visit.departure!)} CT (${carrier.visit.minutes} min on site). Completed pickup: ${formatLoadAmount(fraction)} truck, from JunkWare saved charges. Recorded assignment: ${assigned || 'Unassigned'}. OpsCenter credits the physical load to ${truck}.`;
    result.push({key:createHash('sha256').update(marker).digest('hex'),date,appointmentId:id,note});
  }
  return result;
}

export function pickupSourceNoteNotices(date:string,jobs:PickupJob[]) {
  let names:string[];
  try {names=fs.readdirSync(directory());} catch{return [];}
  const notices:Array<{requestId:string;recordId:string;message:string}>=[];
  for(const name of names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name))) {
    let receipt:Receipt;
    try {receipt=JSON.parse(fs.readFileSync(path.join(directory(),name),'utf8'));} catch {continue;}
    if(receipt.date!==date || name!==`${receipt.key}.json`) continue;
    const notes=jobs.find(job=>job.appointmentId===receipt.appointmentId)?.appointmentNotes || [];
    const clean=(text:string)=>text.replace(/\s+/g,' ').trim();
    if(receipt.status!=='verified' && notes.some(note=>clean(note).includes(clean(receipt.note)))) {
      save({...receipt,status:'verified',updatedAt:new Date().toISOString()});
      continue;
    }
    if(receipt.status==='uncertain' || receipt.status==='writing' && Date.now()-Date.parse(receipt.updatedAt)>120_000)
      notices.push({requestId:receipt.key,recordId:`${date}:appointment:${receipt.appointmentId}`,message:'Pickup evidence is awaiting JunkWare note verification. No duplicate note has been submitted.'});
  }
  return notices;
}

export async function recordPickupSourceNote(candidate:Candidate,actor:string,write:typeof addJunkwareAppointmentNote=addJunkwareAppointmentNote) {
  fs.mkdirSync(directory(),{recursive:true});
  const receipt:Receipt={...candidate,status:'writing',updatedAt:new Date().toISOString(),actor};
  try { fs.writeFileSync(fileFor(candidate.key),JSON.stringify(receipt),{flag:'wx',mode:0o600}); }
  catch(error) { if((error as NodeJS.ErrnoException).code==='EEXIST') return; throw error; }
  try {
    const result=await write({appointmentId:candidate.appointmentId,note:candidate.note,ifAbsent:true,expectedDate:candidate.date});
    if(result.appointmentId!==candidate.appointmentId || result.note!==candidate.note || !Number.isFinite(Date.parse(result.verifiedAt))) throw new Error('Unverified note result');
    save({...receipt,status:'verified',updatedAt:result.verifiedAt});
  } catch {
    // Reserve before sending. A timeout must never automatically resubmit.
    save({...receipt,status:'uncertain',updatedAt:new Date().toISOString()});
  }
}

/** Authorized current-day reconciliation, one bounded write per refresh. */
export async function recordNextPickupSourceNote(date:string,actor:string) {
  await withJobRouteAssignmentSyncLock(async()=>{
    const now=Date.now(), observed=Date.parse(junkwareScheduleUpdatedAt(date)||'');
    if(date!==chicagoDateKey(new Date(now)) || !Number.isFinite(observed) || now-observed>120_000 || observed>now) return;
    const jobs=readJobRows(date);
    const candidates=pickupSourceNoteCandidates(date,jobs,readScheduleVisits(date).visits);
    const candidate=candidates.find(item=>!fs.existsSync(fileFor(item.key)));
    if(candidate) await withJunkwareAppointmentSyncLock(candidate.appointmentId,()=>recordPickupSourceNote(candidate,actor));
  });
}
