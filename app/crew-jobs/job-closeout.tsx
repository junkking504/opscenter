'use client';
import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import AppointmentCloseout, {type CloseoutJob, type CloseoutTransport} from '../../desktop-ui/appointment-closeout';
import type { CrewCurrentJob } from '@/lib/crew-dispatch';
import type { Receipt } from '../../desktop-ui/schedule-receipt';
import { submitScheduleOperation } from '../../desktop-ui/lib/schedule-operation-transport';
import { crewCloseoutKey, readCloseoutLocal, writeCloseoutLocal, appointmentDraftScope, migrateCloseoutDraft } from '../../desktop-ui/lib/closeout-drafts';
import '../../desktop-ui/mobile-closeout/mobile-closeout.css';
import JobPhotos, {type PhotoProgress, type PhotoCheckoutHandle} from './job-photos';
import styles from './phone-access.module.css';
import {sameCheckoutFields} from './photo-checkout';
import {createHandoff,draftHandoff,readHandoffs,resumeHandoff,retryAttentionHandoff,saveHandoff} from './checkout-handoff';

export default function JobCloseout({job,truck,deviceId,test=false,onBusyChange,onBack,onNext,onAccepted,onHandoffFailed}:{job:CrewCurrentJob;truck:string;deviceId:string;test?:boolean;onBusyChange:(busy:boolean)=>void;onBack:()=>void;onNext:()=>void;onAccepted?:(receipt:Receipt,assignmentId:string)=>void;onHandoffFailed?:(message:string)=>void;}) {
  const [completed,setCompleted]=useState(false);
  const [photos,setPhotos]=useState<PhotoProgress>({ready:false,count:0,verified:0});
  const [dryRun,setDryRun]=useState(false);
  const dryRunMode=useRef(false);
  const photoSubmit=useRef<PhotoCheckoutHandle>(null);
  const [submissionMessage,setSubmissionMessage]=useState('');
  const [photoBusy,setPhotoBusy]=useState(false),[formBusy,setFormBusy]=useState(false);
  const busy=photoBusy || formBusy;
  const reportPhotos=useCallback((progress:PhotoProgress)=>setPhotos(progress),[]);
  useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false);},[busy,onBusyChange]);
  const authorizationId=useRef(job.assignmentId),sourceSnapshot=useRef<Record<string,unknown>|null>(null);
  const verified=useRef(false),jobVersion=useRef(''),crewVersion=useRef(0),sourceFieldsVersion=useRef('');
  const draftScope=appointmentDraftScope(job);
  const key=crewCloseoutKey(deviceId,draftScope);
  const photoKey=`${deviceId}:${draftScope}`;
  const aliasesJson=JSON.stringify([...new Set([job.assignmentId,...(job.draftAssignmentIds || [])])]);
  const endpoint=`/api/crew-jobs/closeout?assignmentId=${encodeURIComponent(job.assignmentId)}`;
  const transport=useMemo<CloseoutTransport>(()=>{
    const aliases=JSON.parse(aliasesJson) as string[];
    const receiptAssignment=(requestId:string)=>{
      const local=readCloseoutLocal<Receipt & {assignmentId?:string}>(`${key}:receipt`);
      return readHandoffs(deviceId).find(value=>value.requestId===requestId)?.assignmentId || (local?.requestId===requestId?local.assignmentId:undefined) || job.assignmentId;
    };
    const keep=(receipt:Receipt)=>{if(receipt.dryRun)return receipt;writeCloseoutLocal(`${key}:receipt`,{...receipt,assignmentId:receiptAssignment(receipt.requestId)});verified.current=receipt.status==='verified' && (receipt.sourceResult?.closeout as {status?:{value:string}})?.status?.value==='8';return receipt;};
    const accepted=(receipt:Receipt,dismiss=false)=>{
      const saved=keep(receipt);
      const intent=readHandoffs(deviceId).find(value=>value.requestId===saved.requestId);
      if(intent)saveHandoff({...intent,receipt:saved,phase:['pending','verified'].includes(saved.status)?'accepted':'attention',message:saved.message});
      if(dismiss && ['pending','verified'].includes(saved.status))onAccepted?.(saved,receiptAssignment(saved.requestId));
      else if(saved.status==='failed')onHandoffFailed?.(`Checkout was not saved. ${saved.message}`);
      return saved;
    };
    async function check(requestId:string,reconcile=true,dismiss=true){
      const intent=readHandoffs(deviceId).find(value=>value.requestId===requestId);
      const local=readCloseoutLocal<Receipt & {assignmentId?:string}>(`${key}:receipt`);
      const receiptAssignment=intent?.assignmentId || (local?.requestId===requestId?local.assignmentId:undefined) || job.assignmentId;
      const receiptEndpoint=`/api/crew-jobs/closeout?assignmentId=${encodeURIComponent(receiptAssignment)}`;
      const response=await fetch(`${receiptEndpoint}&requestId=${encodeURIComponent(requestId)}${reconcile?'&reconcile=1':''}`,{cache:'no-store',signal:AbortSignal.timeout(210_000)});
      const body=await response.json();
      if(response.ok && body.receipt)return accepted(body.receipt,dismiss);
      // A failed intake has no durable server receipt yet. Continue only the
      // exact immutable phone handoff; transferCheckout checks for a receipt
      // again before it re-sends this same request ID and payload.
      if(response.status===404){
        const handoff=readHandoffs(deviceId).find(value=>value.requestId===requestId);
        if(handoff && ['transferring','submitting'].includes(handoff.phase)){
          const recovered=await resumeHandoff(handoff);
          if(recovered)return accepted(recovered,dismiss);
          const latest=readHandoffs(deviceId).find(value=>value.requestId===requestId);
          throw new Error(latest?.message || 'Transfer is still paused. Keep this checkout saved on this phone and check again.');
        }
        // A transient preflight rejection leaves the immutable handoff in
        // attention without a server receipt. A deliberate check may reopen
        // only that same request ID/body. The server rechecks the reviewed
        // JunkWare fingerprint before any write, so a prior save or source
        // change fails closed instead of recording another payment.
        if(reconcile && handoff?.phase==='attention' && !handoff.receipt){
          const recovered=await retryAttentionHandoff(handoff);
          if(recovered)return accepted(recovered,dismiss);
          const latest=readHandoffs(deviceId).find(value=>value.requestId===requestId);
          throw new Error(latest?.message || 'The exact saved checkout still needs review. Do not enter another payment.');
        }
      }
      throw new Error(body.error || 'Saved result unavailable. Do not repeat this payment.');
    }
    async function currentAssignment(){
      const response=await fetch('/api/crew-jobs/current',{cache:'no-store',signal:AbortSignal.timeout(15_000)});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error || 'Current assignment could not be checked. Your draft is still on this phone.');
      const current=(body.jobs || (body.job?[body.job]:[])).find((value:CrewCurrentJob)=>value.appointmentId===job.appointmentId && value.date===job.date);
      if(!current?.assignmentId || (current.draftScope && current.draftScope!==draftScope))throw new Error('This appointment was moved or reset. Your draft is preserved; return to Assignments to review its current status.');
      return current.assignmentId as string;
    }
    return {
      async prepare(){
        if(dryRunMode.current){setSubmissionMessage('Checking the dry run. No live results will be posted.');return;}
        if(!photoSubmit.current)throw new Error('Photo selection is unavailable. Return to photos before submitting.');
        if(!photoSubmit.current.ready())throw new Error('Photos are still being saved on this phone. Wait a moment before submitting.');
        const assignmentId=await currentAssignment();
        if(assignmentId!==authorizationId.current){
          const response=await fetch(`/api/crew-jobs/closeout?assignmentId=${encodeURIComponent(assignmentId)}`,{cache:'no-store',signal:AbortSignal.timeout(210_000)});
          const fresh=await response.json();
          if(!response.ok || !fresh.canWrite || fresh.pendingReceipt || !sourceSnapshot.current || !sameCheckoutFields(sourceSnapshot.current,fresh.closeout) || fresh.crewVersion!==crewVersion.current)throw new Error('The appointment or crew changed. Your draft is preserved. Reload from JunkWare and review before submitting.');
          // Only an equivalent fresh, authorized source may replace the request
          // scope. The entered values and original reviewed fingerprint stay put.
          authorizationId.current=assignmentId;jobVersion.current=fresh.jobVersion;
        }
        if(!photoSubmit.current.ready(assignmentId))throw new Error('Photos are still being saved on this phone. Wait a moment before submitting.');
        return {background:true};
      },
      async load(refresh=false){
        setCompleted(false);
        migrateCloseoutDraft(key,aliases.map(id=>crewCloseoutKey(deviceId,id)));
        if(refresh)authorizationId.current=await currentAssignment();
        const loadEndpoint=`/api/crew-jobs/closeout?assignmentId=${encodeURIComponent(authorizationId.current)}`;
        const response=await fetch(`${loadEndpoint}${refresh?'&refresh=1':''}`,{cache:'no-store',signal:AbortSignal.timeout(210_000)});
        const body=await response.json();if(!response.ok || !body.closeout)throw new Error(body.error || 'The closeout could not be loaded.');
        sourceSnapshot.current=body.closeout;
        dryRunMode.current=body.dryRun===true;setDryRun(dryRunMode.current);
        jobVersion.current=body.jobVersion;crewVersion.current=body.crewVersion;sourceFieldsVersion.current=body.sourceFieldsVersion || '';
        const intent=draftHandoff(deviceId,key,aliases);
        const aliasReceipt=aliases.map(assignmentId=>({assignmentId,receipt:readCloseoutLocal<Receipt>(`${crewCloseoutKey(deviceId,assignmentId)}:receipt`)})).find(value=>value.receipt && value.receipt.status!=='failed');
        const local=intent?.receipt || readCloseoutLocal<Receipt>(`${key}:receipt`) || aliasReceipt?.receipt;
        if(local && aliasReceipt?.receipt?.requestId===local.requestId && !intent && !readCloseoutLocal(`${key}:receipt`))writeCloseoutLocal(`${key}:receipt`,{...local,assignmentId:aliasReceipt.assignmentId});
        if(body.pendingReceipt)keep(body.pendingReceipt);
        else if(local && local.status!=='failed'){
          try{body.pendingReceipt=await check(local.requestId,false,false);}
          catch{body.pendingReceipt={requestId:local.requestId,action:'closeout',status:'uncertain',message:'The earlier result is unavailable. Check Saved Result; do not record another payment.'};}
        }
        if(!body.pendingReceipt && intent && !intent.receipt && ['transferring','submitting','attention'].includes(intent.phase))body.pendingReceipt={requestId:intent.requestId,action:'closeout',status:'uncertain',message:intent.message || 'The earlier submission is saved on this phone. Check Saved Result; do not enter another payment.'};
        return body;
      },
      async send(values,requestId){
        if(!dryRunMode.current){
          const assignmentId=authorizationId.current;
          const handoff=await createHandoff(deviceId,assignmentId,{assignmentId,requestId,expectedVersion:jobVersion.current,crewVersion:crewVersion.current,values:{...values,...(sourceFieldsVersion.current?{expectedSourceFieldsVersion:sourceFieldsVersion.current}:{})}},{draftKey:key,photoKey,assignmentIds:[...aliases,assignmentId]});
          let receipt=await resumeHandoff(handoff);
          if(!receipt && navigator.onLine){
            const latest=readHandoffs(deviceId).find(value=>value.requestId===requestId);
            if(latest && latest.phase!=='attention')receipt=await resumeHandoff(latest);
          }
          if(!receipt)throw new Error('Transfer paused. Stay on this checkout and tap Submit again to continue the same saved submission.');
          return accepted(receipt,true);
        }
        return submitScheduleOperation({assignmentId:job.assignmentId,requestId,expectedVersion:jobVersion.current,crewVersion:crewVersion.current,values:{...values,...(sourceFieldsVersion.current?{expectedSourceFieldsVersion:sourceFieldsVersion.current}:{})},photoRequestIds:[],dryRun:true},{endpoint,waitForCompletion:false});
      },
      check,
    };
  },[endpoint,key,photoKey,aliasesJson,deviceId,job.assignmentId,job.appointmentId,job.date,draftScope,onAccepted,onHandoffFailed]);
  const closeoutJob:CloseoutJob={appointmentId:job.appointmentId,appointmentUrl:'',status:'Confirmed',appointmentType:'Job',truck,jkNumber:job.jkNumber,customerName:job.customerName,recordId:`${job.date}:appointment:${job.appointmentId}`,version:''};
  return <section className="company-phone-closeout crew-mobile ops-live"><div className="job-record-drawer mobile-closeout-host">
    <h2>Job closeout</h2><p>Before photos → Charges → After photos → Payment. {dryRun?"Test the complete flow without posting results.":"Submit once. Waypoint returns to Assignments only after the photos and checkout are safely on the server; JunkWare then finishes in the background."}</p>
    {dryRun && <p role="status"><strong>Dry run</strong> — Photos, charges and payment will not be posted to JunkWare. No customer receipt will be sent.</p>}
    {formBusy && submissionMessage && <p role="status">{submissionMessage}</p>}
    <AppointmentCloseout dryRun={dryRun} job={closeoutJob} date={job.date} presentation="mobile" transport={transport} draftKey={key} onBusyChange={setFormBusy} photoSteps={{render:category=><JobPhotos ref={photoSubmit} dryRun={dryRun} deferred locked={formBusy} deviceId={deviceId} assignmentId={job.assignmentId} storageKey={photoKey} storageAliases={(JSON.parse(aliasesJson) as string[]).map(id=>`${deviceId}:${id}`)} category={category} onBusyChange={setPhotoBusy} onProgress={reportPhotos}/>,hasPhotos:photos.count>0,busy:photoBusy}} onBackToAppointment={onBack} saved={()=>{setCompleted(dryRunMode.current || verified.current);setSubmissionMessage(verified.current?'Checkout saved and verified in JunkWare.':'');}}/>
    <footer className="record-drawer-actions"><div className="closeout-footer-slot"/></footer>
    {completed && <div className={styles.card}><h2>{dryRun?'Dry run complete':'Closeout verified'}</h2><p>{dryRun?'Nothing was uploaded or saved to JunkWare. No customer receipt was sent.':'The saved work and payment are confirmed in JunkWare.'}</p>{(!dryRun || test) && <button className={styles.primary} onClick={onNext}>Check next assignment</button>}</div>}
  </div></section>;
}
