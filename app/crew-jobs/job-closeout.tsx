'use client';
import { useMemo, useRef, useState } from 'react';
import AppointmentCloseout, {type CloseoutJob, type CloseoutTransport} from '../../desktop-ui/appointment-closeout';
import type { CrewCurrentJob } from '@/lib/crew-dispatch';
import type { Receipt } from '../../desktop-ui/schedule-receipt';
import { submitScheduleOperation } from '../../desktop-ui/lib/schedule-operation-transport';
import { crewCloseoutKey, readCloseoutLocal, writeCloseoutLocal } from '../../desktop-ui/lib/closeout-drafts';
import '../../desktop-ui/mobile-closeout/mobile-closeout.css';
import styles from './phone-access.module.css';

export default function JobCloseout({job,truck,deviceId,onBusyChange,onBack,onNext}:{job:CrewCurrentJob;truck:string;deviceId:string;onBusyChange:(busy:boolean)=>void;onBack:()=>void;onNext:()=>void}) {
  const [completed,setCompleted]=useState(false);
  const verified=useRef(false),jobVersion=useRef('');
  const key=crewCloseoutKey(deviceId,job.assignmentId);
  const endpoint=`/api/crew-jobs/closeout?assignmentId=${encodeURIComponent(job.assignmentId)}`;
  const transport=useMemo<CloseoutTransport>(()=>{
    const keep=(receipt:Receipt)=>{writeCloseoutLocal(`${key}:receipt`,receipt);verified.current=receipt.status==='verified' && (receipt.sourceResult?.closeout as {status?:{value:string}})?.status?.value==='8';return receipt;};
    async function check(requestId:string,reconcile=true){
      const response=await fetch(`${endpoint}&requestId=${encodeURIComponent(requestId)}${reconcile?'&reconcile=1':''}`,{cache:'no-store',signal:AbortSignal.timeout(210_000)});
      const body=await response.json();if(!response.ok || !body.receipt)throw new Error(body.error || 'Saved result unavailable. Do not repeat this payment.');return keep(body.receipt);
    }
    return {
      async load(){
        const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.timeout(210_000)});
        const body=await response.json();if(!response.ok || !body.closeout)throw new Error(body.error || 'The closeout could not be loaded.');
        jobVersion.current=body.jobVersion;
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
        keep({requestId,action:'closeout',status:'pending',message:'Checking the saved closeout. Do not record another payment.'});
        const receipt=await submitScheduleOperation({assignmentId:job.assignmentId,requestId,expectedVersion:jobVersion.current,values},{endpoint});
        return keep(receipt);
      },
      check,
    };
  },[endpoint,key,job.assignmentId]);
  const closeoutJob:CloseoutJob={appointmentId:job.appointmentId,appointmentUrl:'',status:'Confirmed',appointmentType:'Job',truck,jkNumber:job.jkNumber,customerName:job.customerName,recordId:`${job.date}:appointment:${job.appointmentId}`,version:''};
  return <section className="company-phone-closeout crew-mobile ops-live"><div className="job-record-drawer mobile-closeout-host">
    <h2>Job closeout</h2><p>Record collected payments, then review before saving.</p>
    <AppointmentCloseout job={closeoutJob} date={job.date} presentation="mobile" transport={transport} draftKey={key} onBusyChange={onBusyChange} onBackToAppointment={onBack} saved={()=>setCompleted(verified.current)}/>
    <footer className="record-drawer-actions"><div className="closeout-footer-slot"/></footer>
    {completed && <div className={styles.card}><h2>Closeout verified</h2><p>The saved work and payment are confirmed in JunkWare.</p><button className={styles.primary} onClick={onNext}>Check next assignment</button></div>}
  </div></section>;
}
