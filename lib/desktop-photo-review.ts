import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {extractJkNumber} from '@/lib/whatsapp-job-photo-matching';
import {PHOTO_STATES, type PhotoReviewRecord, type PhotoReviewSnapshot, type PhotoState} from '../desktop-ui/lib/photo-review-contract';

export const photoReviewRoot = () => process.env.WHATSAPP_JOB_PHOTO_STATE_DIR || path.join(process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'integrations','whatsapp-job-photos');
const clean=(v:unknown,max=2000)=>typeof v==='string'?v.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max):'';
const time=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export class InvalidPhotoReviewFilter extends Error {}
export function photoReason(reason:string): {label:string;nextStep:string} {
  if(reason==='sender_not_mapped_to_truck')return {label:'Sender mapping needed',nextStep:'Verify which truck used this sender phone at the time of the message, or obtain the exact appointment reference.'};
  if(/jk_(not_on_active_schedule|not_found_in_junkware)/.test(reason))return {label:'Appointment match needed',nextStep:'Confirm the JK number and the intended appointment date. A JK reference alone may have more than one appointment.'};
  if(/uncertain|outcome_unknown/.test(reason))return {label:'Upload outcome uncertain',nextStep:'Inspect the intended JunkWare appointment and its existing photos before any retry; the upload may already have succeeded.'};
  if(/5 MB|5_MB|invalid size/.test(reason))return {label:'Photo too large',nextStep:'Use a JPEG or PNG below the 5 MB JunkWare limit and verify the appointment before submitting a replacement.'};
  if(/fetch failed|network|timeout|Meta media/.test(reason))return {label:'Media retrieval failed',nextStep:'Check that the original media is still available and the appointment is correct before a controlled retry. Old media may need to be resent.'};
  if(reason==='unreadable_record')return {label:'Record unreadable',nextStep:'Recover the original queue record before any upload or retry.'};
  if(reason==='processing')return {label:'Processing',nextStep:'Wait for the worker result. A stale processing record needs outcome verification before it can be retried.'};
  if(reason==='incoming')return {label:'Waiting for worker',nextStep:'Check worker health if this record does not advance.'};
  return {label:'Source review needed',nextStep:'Review the original message, source match, and upload evidence before changing this record.'};
}
function safeRecord(root:string,state:PhotoState,id:string): Record<string,unknown> | null {
  if(!/^[a-f0-9]{64}$/.test(id))return null;
  const file=path.join(root,state,`${id}.json`);
  if(!fs.lstatSync(file).isFile()||fs.statSync(file).size>1000000)throw new Error('Unreadable record');
  const row=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!row||typeof row!=='object'||Array.isArray(row)||hash(String(row.messageId||''))!==id)throw new Error('Invalid record identity');
  return row;
}
export function readPhotoPreview(id:string,state:string,root=photoReviewRoot()) {
  if(!PHOTO_STATES.includes(state as PhotoState))return null;
  try {
    const row=safeRecord(root,state as PhotoState,id); if(!row)return null;
    const ext=row.mimeType==='image/png'?'png':row.mimeType==='image/jpeg'?'jpg':null; if(!ext)return null;
    const file=path.join(root,'media',`${id}.${ext}`);
    const stat=fs.lstatSync(file); if(!stat.isFile()||stat.size>5*1024*1024||stat.size===0)return null;
    const bytes=fs.readFileSync(file);
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(ext==='png'?!png:!jpeg)return null;
    return {bytes,mimeType:ext==='png'?'image/png':'image/jpeg'};
  }catch{return null;}
}
// Listing never loads image bodies. Preview requests recheck queue membership
// and image signatures, so moved records and missing media fail closed.
function cachedPreviewExists(root:string,id:string,mimeType:unknown) {
  const ext=mimeType==='image/png'?'png':mimeType==='image/jpeg'?'jpg':null;
  if(!ext)return false;
  try { const stat=fs.lstatSync(path.join(root,'media',`${id}.${ext}`)); return stat.isFile()&&stat.size>0&&stat.size<=5*1024*1024; } catch { return false; }
}
export function readPhotoReview(params:URLSearchParams,root=photoReviewRoot()):PhotoReviewSnapshot {
  const state=params.get('state')||'all',reason=params.get('reason')||'',sender=params.get('sender')||'',q=(params.get('q')||'').trim().toLowerCase();
  const requestedPage=Number(params.get('page')||1);
  if((state!=='all'&&!PHOTO_STATES.includes(state as PhotoState))||q.length>100||reason.length>150||sender.length>64||!Number.isInteger(requestedPage)||requestedPage<1||requestedPage>100000)throw new InvalidPhotoReviewFilter('Invalid photo review filter.');
  const counts=Object.fromEntries(PHOTO_STATES.map(s=>[s,0])) as Record<PhotoState,number>;
  const unavailableStates:PhotoState[]=[];let unreadable=0;
  const rows:PhotoReviewRecord[]=[];
  for(const queue of PHOTO_STATES){
    let files:string[];try{files=fs.readdirSync(path.join(root,queue)).filter(f=>f.endsWith('.json'));}catch{unavailableStates.push(queue);continue;}
    counts[queue]=files.length;
    for(const file of files){
      const id=file.slice(0,-5);let row:Record<string,unknown>|null=null;
      try{row=safeRecord(root,queue,id);}catch{/* Keep malformed records visible as a count, never an empty-success signal. */}
      if(!row){unreadable++;continue;}
      const review=(row.review&&typeof row.review==='object'?row.review:{}) as Record<string,unknown>;
      const match=(row.match&&typeof row.match==='object'?row.match:{}) as Record<string,unknown>;
      const receivedAt=time(row.receivedAt);const jobDate=receivedAt?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(receivedAt)):null;
      const caption=clean(row.caption);const jk=extractJkNumber(clean(match.jkNumber))||extractJkNumber(caption)||extractJkNumber(clean(review.detail));
      // Worker exceptions may contain provider URLs or identifiers. Return a
      // bounded reason code rather than the original exception or payload.
      const storedReason=clean(review.reason,150),failure=clean(row.error)||clean(row.lastError);
      const rawReason=/^[a-z][a-z0-9_]{0,149}$/.test(storedReason)?storedReason:failure?(/5 MB|invalid size/.test(failure)?'photo_exceeds_5_MB':/fetch failed|network|timeout|Meta media/i.test(failure)?'network_media_failure':'worker_failure'):queue;
      const advice=photoReason(rawReason),phone=clean(row.senderPhone).replace(/\D/g,'');
      const senderKey=hash(phone||id).slice(0,16),senderLabel=phone?`Sender ending ${phone.slice(-4)}`:'Sender unavailable';
      const sourceHref=jk&&jobDate?`/desktop?${new URLSearchParams({data:'live',workspace:'Schedule',date:jobDate,job:jk})}`:null;
      const attemptCount=Number(row.attempts);
      rows.push({id,state:queue,receivedAt,outcomeAt:time(row.outcomeAt),jobDate,sender:senderLabel,senderKey,jk,category:clean(match.category||review.category,40)||'Unspecified',caption,reason:rawReason,reasonLabel:advice.label,nextStep:advice.nextStep,attempts:Number.isFinite(attemptCount)?Math.max(0,Math.floor(attemptCount)):0,previewAvailable:cachedPreviewExists(root,id,row.mimeType),sourceHref});
    }
  }
  const reasons=new Map<string,{reason:string;label:string;count:number}>(),senders=new Map<string,{key:string;label:string;count:number}>();
  for(const row of rows){const r=reasons.get(row.reason)||{reason:row.reason,label:row.reasonLabel,count:0};r.count++;reasons.set(row.reason,r);const s=senders.get(row.senderKey)||{key:row.senderKey,label:row.sender,count:0};s.count++;senders.set(row.senderKey,s);}
  const filtered=rows.filter(r=>(state==='all'||r.state===state)&&(!reason||r.reason===reason)&&(!sender||r.senderKey===sender)&&(!q||`${r.jk} ${r.sender} ${r.caption} ${r.jobDate} ${r.id}`.toLowerCase().includes(q))).sort((a,b)=>(a.receivedAt||'').localeCompare(b.receivedAt||'')||a.id.localeCompare(b.id));
  const pages=Math.max(1,Math.ceil(filtered.length/25)),page=Math.min(requestedPage,pages);
  return {observedAt:new Date().toISOString(),complete:!unavailableStates.length&&!unreadable,unreadable,unavailableStates,counts,total:Object.values(counts).reduce((a,b)=>a+b,0),filtered:filtered.length,page,pages,records:filtered.slice((page-1)*25,page*25),reasons:[...reasons.values()].sort((a,b)=>b.count-a.count),senders:[...senders.values()].sort((a,b)=>b.count-a.count)};
}
