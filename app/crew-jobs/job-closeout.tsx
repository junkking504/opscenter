'use client';
import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import AppointmentCloseout, {type CloseoutJob, type CloseoutTransport} from '../../desktop-ui/appointment-closeout';
import type { CrewCurrentJob } from '@/lib/crew-dispatch';
import type { Receipt } from '../../desktop-ui/schedule-receipt';
import { submitScheduleOperation } from '../../desktop-ui/lib/schedule-operation-transport';
import { crewCloseoutKey, readCloseoutLocal, writeCloseoutLocal } from '../../desktop-ui/lib/closeout-drafts';
import '../../desktop-ui/mobile-closeout/mobile-closeout.css';
import JobPhotos, {type PhotoProgress, type PhotoCheckoutHandle} from './job-photos';
import styles from './phone-access.module.css';

export default function JobCloseout({job,truck,deviceId,onBusyChange,onBack,onNext}:{job:CrewCurrentJob;truck:string;deviceId:string;onBusyChange:(busy:boolean)=>void;onBack:()=>void;onNext:()=>void}) {
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
  const verified=useRef(false),jobVersion=useRef(''),crewVersion=useRef(0);
  const key=crewCloseoutKey(deviceId,job.assignmentId);
  const endpoint=`/api/crew-jobs/closeout?assignmentId=${encodeURIComponent(job.assignmentId)}`;
  const transport=useMemo<CloseoutTransport>(()=>{
    const keep=(receipt:Receipt)=>{if(receipt.dryRun)return receipt;writeCloseoutLocal(`${key}:receipt`,receipt);verified.current=receipt.status==='verified' && (receipt.sourceResult?.closeout as {status?:{value:string}})?.status?.value==='8';return receipt;};
    async function check(requestId:string,reconcile=true){
      const response=await fetch(`${endpoint}&requestId=${encodeURIComponent(requestId)}${reconcile?'&reconcile=1':''}`,{cache:'no-store',signal:AbortSignal.timeout(210_000)});
      const body=await response.json();if(!response.ok || !body.receipt)throw new Error(body.error || 'Saved result unavailable. Do not repeat this payment.');return keep(body.receipt);
    }
    return {
      async prepare(){
        if(dryRunMode.current){setSubmissionMessage('Checking the dry run. No live results will be posted.');return;}
        if(!photoSubmit.current)throw new Error('Photo selection is unavailable. Return to photos before submitting.');
        setSubmissionMessage('Preparing checkout…');
        try {await photoSubmit.current.submit(setSubmissionMessage);setSubmissionMessage('Verifying and saving checkout in JunkWare…');}
        catch(error){setSubmissionMessage('Submission paused. Photos already saved will not be uploaded again. Your payment has not been submitted.');throw error;}
      },
      async load(){
        setCompleted(false);
        const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.timeout(210_000)});
        const body=await response.json();if(!response.ok || !body.closeout)throw new Error(body.error || 'The closeout could not be loaded.');
        dryRunMode.current=body.dryRun===true;setDryRun(dryRunMode.current);
        jobVersion.current=body.jobVersion;crewVersion.current=body.crewVersion;
        const local=readCloseoutLocal<Receipt>(`${key}:receipt`);
        if(body.pendingReceipt)keep(body.pendingReceipt);
        else if(local && local.status!=='failed'){
          try{body.pendingReceipt=await check(local.requestId,false);}
          catch{body.pendingReceipt={requestId:local.requestId,action:'closeout',status:'uncertain',message:'The earlier result is unavailable. Check Saved Result; do not record another payment.'};}
        }
        return body;
      },
      async send(values,requestId){
        // Retain the request identity BEFORE the only POST, including across page reload.
        if(!dryRunMode.current)keep({requestId,action:'closeout',status:'pending',message:'Checking the saved closeout. Do not record another payment.'});
        const receipt=await submitScheduleOperation({assignmentId:job.assignmentId,requestId,expectedVersion:jobVersion.current,crewVersion:crewVersion.current,values,...(dryRunMode.current?{dryRun:true}:{})},{endpoint});
        return keep(receipt);
      },
      check,
    };
  },[endpoint,key,job.assignmentId]);
  const closeoutJob:CloseoutJob={appointmentId:job.appointmentId,appointmentUrl:'',status:'Confirmed',appointmentType:'Job',truck,jkNumber:job.jkNumber,customerName:job.customerName,recordId:`${job.date}:appointment:${job.appointmentId}`,version:''};
  return <section className="company-phone-closeout crew-mobile ops-live"><div className="job-record-drawer mobile-closeout-host">
    <h2>Job closeout</h2><p>Before photos → Charges → After photos → Payment. {dryRun?"Test the complete flow without posting results.":"Everything uploads after your final confirmation."}</p>
    {dryRun && <p role="status"><strong>Dry run</strong> — Photos, charges and payment will not be posted to JunkWare. No customer receipt will be sent.</p>}
    {formBusy && submissionMessage && <p role="status">{submissionMessage}</p>}
    <AppointmentCloseout dryRun={dryRun} job={closeoutJob} date={job.date} presentation="mobile" transport={transport} draftKey={key} onBusyChange={setFormBusy} photoSteps={{render:category=><JobPhotos ref={photoSubmit} dryRun={dryRun} deferred locked={formBusy} deviceId={deviceId} assignmentId={job.assignmentId} category={category} onBusyChange={setPhotoBusy} onProgress={reportPhotos}/>,hasPhotos:photos.count>0,busy:photoBusy}} onBackToAppointment={onBack} saved={()=>{setCompleted(dryRunMode.current || verified.current);setSubmissionMessage(verified.current?'Checkout saved and verified in JunkWare.':'');}}/>
    <footer className="record-drawer-actions"><div className="closeout-footer-slot"/></footer>
    {completed && <div className={styles.card}><h2>{dryRun?'Dry run complete':'Closeout verified'}</h2><p>{dryRun?'Nothing was uploaded or saved to JunkWare. No customer receipt was sent.':'The saved work and payment are confirmed in JunkWare.'}</p>{!dryRun && <button className={styles.primary} onClick={onNext}>Check next assignment</button>}</div>}
  </div></section>;
}
