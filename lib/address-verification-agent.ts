import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readJobRows} from './desktop-schedule-source';
import {readVerifiedJunkwareScheduleSnapshot} from './junkware-fast-schedule';
import {cachedAddressVerification,verifyDesktopAddress,type AddressVerification} from './desktop-address-verification';
import {planningLocation} from './planning-geocodes';
import {publishAddressEvidence} from './address-research-store';
import {parcelAnchorMatches,verifyParcelAddress,type StopAddressAnchor} from './parcel-address-verification';
import type {AddressEvidence} from './address-research-evidence';

const normalize=(value:string)=>value.replace(/\s+/g,' ').replace(/\s*,\s*/g,', ').trim().toUpperCase();
const hash=(value:string)=>createHash('sha256').update(normalize(value)).digest('hex');
const read=(file:string)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw error;}};
const write=(file:string,value:unknown)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);};
type Job={address:string;appointmentId?:string;truck?:string};
type Item={address:string;dates:string[];status:'verified'|'pending';reason:string;checkedAt:number;nextAttemptAt:number;anchorKey?:string;source?:string};
type State={version:1;agentId:'address-verification';heartbeatAt:string;lastSuccessAt?:string;status:'ok'|'pending'|'error';error?:string;items:Record<string,Item>;parcelBudget:{day:string;requests:number};checked:number;verified:number};
type Options={root?:string;now?:number;readJobs?:(date:string)=>Job[];snapshot?:typeof readVerifiedJunkwareScheduleSnapshot;
  lookup?:(address:string)=>Promise<AddressVerification>;cached?:(address:string)=>AddressVerification|undefined;
  parcel?:(address:string,anchor:StopAddressAnchor)=>Promise<AddressEvidence>;publish?:typeof publishAddressEvidence};
const truckKey=(value:unknown)=>String(value||'').match(/\d+/)?.[0]?.replace(/^0+/,'')||'';

export function stopAnchorForJob(job:Job,visits:unknown):StopAddressAnchor|undefined {
  if(!Array.isArray(visits) || !job.appointmentId || !truckKey(job.truck))return;
  const matches=visits.filter(v=>v?.appointment_id===job.appointmentId && v.match_confidence==='confirmed'
    && v.match_reason==='exact_address_native_stop_with_gps_dwell' && truckKey(v.truck_number)===truckKey(job.truck));
  if(matches.length!==1)return;
  const evidence=matches[0].location_evidence,identity=evidence?.address_identity;
  if(evidence?.source!=='LinxUp native stop address' || !Array.isArray(identity) || identity.length!==3)return;
  const anchor={street:identity[0],city:identity[1],zip:identity[2],latitude:evidence.latitude,longitude:evidence.longitude};
  return parcelAnchorMatches(job.address,anchor)?anchor:undefined;
}

/** Owns scheduled address recovery. No appointment, assignment, cost or message
 * writes, and no AI calls. Run under the dedicated OS lock. */
export async function runAddressVerificationAgent(target:string,options:Options={}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(target))throw new Error('Service date required');
  const root=options.root||process.env.OPSCENTER_DATA_DIR||process.env.OPSBOT_DATA_DIR||path.join(process.env.HOME||'','.openclaw/workspace/opsbot/data');
  const now=options.now??Date.now(),stamp=new Date(now).toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(now);
  const stateFile=path.join(root,'addresses/agent/state.json'),prior=read(stateFile) as Partial<State>;
  if(Object.keys(prior).length && (prior.version!==1 || prior.agentId!=='address-verification' || !prior.items
    || !prior.parcelBudget || !Number.isInteger(prior.parcelBudget.requests) || prior.parcelBudget.requests<0 || prior.parcelBudget.requests>100))throw new Error('Address agent state needs recovery; request limits retained.');
  if(prior.heartbeatAt && Date.parse(prior.heartbeatAt)>now)throw new Error('Address agent clock is older than its saved state.');
  const state:State={version:1,agentId:'address-verification',heartbeatAt:stamp,lastSuccessAt:prior.lastSuccessAt,status:'pending',items:prior.items||{},
    parcelBudget:prior.parcelBudget?.day===day?prior.parcelBudget:{day,requests:0},checked:0,verified:0};
  const save=()=>write(stateFile,state);
  save();
  try {
    const snapshot=(options.snapshot||readVerifiedJunkwareScheduleSnapshot)(root,target);
    const supplemental=path.join(root,'history/linxup/junkware_appointment_sources',`junkware_appointments_${target}.json`),old=read(supplemental);
    if(snapshot && snapshot.freshnessAtMs>now-10*60_000 && snapshot.updatedAtMs>Date.parse(old.scraped_at||old.collection_timestamp||'1970-01-01'))
      write(supplemental,{date:target,scraped_at:snapshot.scrapedAt,collection_timestamp:snapshot.updatedAt,appointments:snapshot.appointments,cancelled:snapshot.cancelled,verification:{verified_date:target,all_territories_verified:true},source:'verified_current_schedule'});
    const history=path.join(root,'history/junkware'),dates=new Set<string>([target]);
    const oldest=new Date(Date.parse(`${target}T12:00:00Z`)-7*86400_000).toISOString().slice(0,10);
    for(const file of fs.existsSync(history)?fs.readdirSync(history):[]) {
      const date=file.match(/(\d{4}-\d{2}-\d{2})/)?.[1];if(date && date>=oldest)dates.add(date);
    }
    const candidates=new Map<string,{address:string;dates:string[];anchor?:StopAddressAnchor}>();
    for(const date of [target,...[...dates].filter(d=>d!==target).sort()]) {
      const visits=read(path.join(root,'history/linxup/appointment_visits',`linxup_appointment_visits_${date}.json`)).visits;
      const jobs:Job[]=[...(options.readJobs||readJobRows)(date),...((options.snapshot||readVerifiedJunkwareScheduleSnapshot)(root,date)?.appointments||[]).map(row=>({address:String(row.address||''),appointmentId:String(row.appt_id||''),truck:String(row.truck||'')}))];
      for(const job of jobs) {
        if(!job.address || job.address==='—')continue;
        const id=hash(job.address),candidate=candidates.get(id)||{address:job.address,dates:[]};
        if(!candidate.dates.includes(date))candidate.dates.push(date);
        candidate.anchor ||= stopAnchorForJob(job,visits);
        candidates.set(id,candidate);
      }
    }
    const geocodeFile=path.join(root,'cache/appointment_geocodes.json');
    const publishCache=(address:string,result:AddressVerification,affectedDates:string[])=>{
      if(!result.location)return;
      const id=hash(address),cache=read(geocodeFile),before=cache.addresses?.[id];
      if(before?.latitude===result.location.latitude && before?.longitude===result.location.longitude && before?.house_street_verified)return;
      const entry={...result.location,normalized_address:normalize(address),match_confidence:'confirmed',house_street_verified:true,
        geocoder_source:result.source||'Shared full-address verifier',source_url:result.sourceUrl,reason:result.reason,collection_timestamp:stamp};
      // Publish a guarded replay intent first: a crash cannot strand a saved
      // correction. The consumer waits until these exact coordinates exist.
      for(const date of affectedDates.filter(date=>date<=target))write(path.join(root,'addresses/agent/rematch',`${date}-${randomUUID()}.json`),
        {date,verifiedAt:stamp,geocodeKey:id,latitude:entry.latitude,longitude:entry.longitude});
      execFileSync('python3',[path.join(process.cwd(),'scripts/merge-appointment-geocodes.py'),geocodeFile],{input:JSON.stringify({baseline:{addresses:before?{[id]:before}:{}},proposal:{addresses:{[id]:entry},last_updated_at:stamp}}),timeout:5000});
    };
    const unresolved=[];
    for(const [id,candidate] of candidates) {
      const cached=(options.cached||cachedAddressVerification)(candidate.address);
      if(cached?.location)publishCache(candidate.address,cached,candidate.dates);
      const point=cached?.location||planningLocation(candidate.address,read(geocodeFile).addresses||{});
      const previous=state.items[id];
      if(point){state.items[id]={address:candidate.address,dates:candidate.dates,status:'verified',reason:cached?.reason||'Verified location available',checkedAt:now,nextAttemptAt:now+7*86400_000,source:cached?.source};continue;}
      const anchorKey=candidate.anchor?JSON.stringify(candidate.anchor):undefined;
      state.items[id]={address:candidate.address,dates:candidate.dates,status:'pending',reason:previous?.reason||'Queued for automatic verification',checkedAt:previous?.checkedAt||0,nextAttemptAt:previous?.nextAttemptAt||0,anchorKey:previous?.anchorKey};
      if((previous?.nextAttemptAt||0)<=now || anchorKey && anchorKey!==previous?.anchorKey)unresolved.push({id,...candidate,anchorKey});
    }
    // Fair rotation, two ordinary lookups at most per tick. New stop evidence
    // bypasses old failure backoff without repeating paid research.
    unresolved.sort((a,b)=>(state.items[a.id].checkedAt-state.items[b.id].checkedAt));
    for(const candidate of unresolved.slice(0,2)) {
      const item=state.items[candidate.id];item.checkedAt=now;item.nextAttemptAt=now+6*3600_000;item.anchorKey=candidate.anchorKey;save();
      let result=(options.cached||cachedAddressVerification)(candidate.address)||await (options.lookup||verifyDesktopAddress)(candidate.address);
      if(!result.location && candidate.anchor && state.parcelBudget.requests<100) {
        // Reserve durably before every request, even if interrupted. This free
        // public dataset has no credentials or billing; retain a hard daily cap.
        state.parcelBudget.requests++;save();
        const evidence=await (options.parcel||verifyParcelAddress)(candidate.address,candidate.anchor);
        if(evidence.location){(options.publish||publishAddressEvidence)(candidate.address,evidence,root);result=evidence;}
      }
      state.checked++;item.reason=result.reason;item.source=result.source;
      if(result.location){publishCache(candidate.address,result,candidate.dates);item.status='verified';item.nextAttemptAt=now+7*86400_000;state.verified++;}
      else if(result.retryAfterMs)item.nextAttemptAt=now+Math.max(60_000,result.retryAfterMs);
      save();
    }
    state.items=Object.fromEntries(Object.entries(state.items).filter(([id])=>candidates.has(id)));
    state.status=Object.values(state.items).some(item=>item.status==='pending')?'pending':'ok';
    state.lastSuccessAt=stamp;save();return state;
  }catch(error){state.status='error';state.error=error instanceof Error?error.message:'Address verification failed';save();throw error;}
}
