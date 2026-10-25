'use client';
/* eslint-disable @next/next/no-img-element -- Authenticated same-origin image response; no public source URL or image optimizer. */
import {useEffect,useId,useRef,useState} from 'react';
import type {DesktopAppointment} from '@/lib/desktop-schedule';
import {managerAppointmentDisplay} from './manager-presentation';
import {managerOutcome} from './manager-outcome';
import layout from './manager.module.css';

function protectedPhoto(url:string,date:string,recordId:string) {
 try {
  if(!url.startsWith('/api/crew-jobs/manager?'))return false;
  const q=new URLSearchParams(url.slice('/api/crew-jobs/manager?'.length));
  return !url.includes('#')&&q.size===4&&q.get('resource')==='photo'&&q.get('date')===date&&q.get('recordId')===recordId&&/^[a-f0-9]{64}$/.test(q.get('photo')||'');
 }catch{return false;}
}
export default function ManagerPhotos({job,date}:{job:DesktopAppointment;date:string}) {
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null),heading=useId();
 const [selected,setSelected]=useState<number|null>(null),[state,setState]=useState<'loading'|'ready'|'failed'>('loading');
 const photos=job.photos||[],photo=selected===null?null:photos[selected],name=managerAppointmentDisplay(job).customerName;
 const available=photo&&protectedPhoto(photo.url,date,job.recordId);
 useEffect(()=>{
  if(selected===null)return;
  if(!dialog.current?.open){dialog.current?.showModal();closeButton.current?.focus({preventScroll:true});}
 },[selected]);
 function close(){dialog.current?.close();setSelected(null);trigger.current?.focus({preventScroll:true});}
 function open(index:number){setState('loading');setSelected(index);}
 return <div className={layout.photos}>
  {photos.length?<button ref={trigger} type="button" aria-haspopup="dialog" onClick={()=>open(0)}>View {photos.length} photo{photos.length===1?'':'s'}<span className={layout.srOnly}> for {name}</span></button>:<small>{managerOutcome(job).photos}</small>}
  {photos.length>0&&!job.photoAuditAvailable&&<small>Recorded photos · completeness unavailable</small>}
  <dialog ref={dialog} className={layout.gallery} aria-labelledby={heading} onCancel={event=>{event.preventDefault();close();}} onKeyDown={event=>{if(event.key==='Tab'){const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}if(event.key==='ArrowLeft'&&selected!==null&&selected>0){event.preventDefault();open(selected-1);}if(event.key==='ArrowRight'&&selected!==null&&selected<photos.length-1){event.preventDefault();open(selected+1);}}}>
   {selected!==null&&<><header><h2 id={heading}>Appointment photos</h2><button ref={closeButton} type="button" onClick={close}>Close photos</button></header><p>{name} · {job.jkNumber}</p>
    <p aria-live="polite">{photo?.category || 'Job'} photo · {selected+1} of {photos.length}</p>
    {(!available||state==='failed')?<p role="status">Photo unavailable. Close photos and refresh the appointment to check again.</p>:<><p role="status">{state==='loading'?'Loading photo…':''}</p><img key={photo.url} src={photo.url} referrerPolicy="no-referrer" alt={`${photo.category} appointment photo ${selected+1} of ${photos.length}`} onLoad={()=>setState('ready')} onError={()=>setState('failed')}/></>}
    <nav aria-label="Photo controls"><button type="button" disabled={selected===0} onClick={()=>open(selected-1)}>Previous photo</button><button type="button" disabled={selected>=photos.length-1} onClick={()=>open(selected+1)}>Next photo</button></nav>
   </>}
  </dialog>
 </div>;
}
