import {appointmentAddressDisplay} from '../lib/appointment-address-display';
import { appointmentAccountLabel } from '../lib/appointment-account-marker';
import { useEffect, useRef } from 'react';
import { SheetDismissHandle } from './components/mobile-interactions';
import { appointmentDirectionsHref } from '../lib/appointment-navigation';
import { appointmentServiceAddress } from '../lib/service-address-format';
import { truckDisplayText } from '../lib/junkware-trucks';
import { appointmentCategory, appointmentStatus, assignmentNeedsVerification, needsScheduleAddressVerification, scheduleCustomerLabel, scheduleDisplayTruck, scheduleTruckMismatch, type ScheduleAppointment } from './lib/schedule-contract';
import { schedulePayment } from './lib/schedule-payment';
import { appointmentSummaryCancellation, appointmentSummaryPhoneHref, appointmentSummaryWork } from './lib/appointment-summary';
import './appointment-summary-dialog.css';

/** Snapshot-only preview: operational components mount only after Full details. */
export function AppointmentSummaryDialog({job,date,close,openDetails,returnFocus}: {job:ScheduleAppointment;date:string;close:()=>void;openDetails:()=>void;returnFocus:HTMLElement|null}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const latest=useRef(close);latest.current=close;
  const origin=useRef(returnFocus);
  useEffect(()=>{const node=dialog.current,previous=origin.current;node?.showModal();return()=>{node?.close();if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
  const payment=schedulePayment(job),mismatch=scheduleTruckMismatch(job);
  const work=appointmentSummaryWork(job),cancellation=appointmentSummaryCancellation(job),phoneHref=appointmentSummaryPhoneHref(job.phone);
  const sourceWork=(job.pickupItems?.length?job.pickupItems:job.junkItems).join(' · ');
  const {address}=appointmentAddressDisplay(appointmentServiceAddress(job)),{programLabel}=appointmentAddressDisplay(job.address),directionsHref=appointmentDirectionsHref(address);
  const notes=job.appointmentNotes.map(note=>note.trim()).filter(Boolean);
  return <dialog ref={dialog} className="appointment-summary-dialog" aria-labelledby="appointment-summary-title" onCancel={event=>{event.preventDefault();latest.current();}} onClick={event=>{if(event.target===event.currentTarget)close();}}>
    <SheetDismissHandle label="Close summary" onDismiss={close}/>
    <header><div><p>{appointmentCategory(job)} · {appointmentStatus(job)}</p><h2 id="appointment-summary-title">{scheduleCustomerLabel(job)}</h2><p>{job.jkNumber}{appointmentAccountLabel(job)&&<span role="img" aria-label={appointmentAccountLabel(job)||undefined}> *</span>} · {date}</p></div><button type="button" aria-label="Close appointment summary" onClick={close}>×</button></header>
    <div className="appointment-summary-content">
      {programLabel&&<p>Program: {programLabel}</p>}
      <dl><div><dt>Time</dt><dd>{job.appointmentTime||'Time not recorded'}</dd></div><div><dt>Truck</dt><dd>{truckDisplayText(scheduleDisplayTruck(job))}</dd></div><div className="summary-wide"><dt>Service address</dt><dd>{directionsHref?<a style={{display:'flex',flexDirection:'column',justifyContent:'center',minHeight:44,color:'inherit',textDecoration:'underline',textUnderlineOffset:'.15em'}} href={directionsHref} aria-label={`Directions to ${address} (opens in a new tab)`} target="_blank" rel="noopener noreferrer" onClick={event=>event.stopPropagation()}>{address}<span style={{fontSize:'var(--oc-type-12)'}}>Directions ↗</span></a>:address||'Address unavailable'}</dd></div></dl>
      <dl><div className="summary-wide"><dt>Customer phone</dt><dd>{phoneHref?<a style={{display:'flex',alignItems:'center',minHeight:44,color:'inherit',textDecoration:'underline',textUnderlineOffset:'.15em'}} href={phoneHref} aria-label={`Call ${job.phone}`} onClick={event=>event.stopPropagation()}>{job.phone}</a>:job.phone.trim() && !/^(?:—|-|n\/a|unavailable)$/i.test(job.phone.trim()) ? `${job.phone} · Phone unavailable for calling` : 'Phone unavailable'}</dd></div></dl>
      {assignmentNeedsVerification(job)&&<p className="summary-warning">Assignment not verified</p>}
      {mismatch&&<p className="summary-warning">GPS confirmed · JunkWare says {truckDisplayText(mismatch.junkwareTruck)}</p>}
      {needsScheduleAddressVerification(job)&&<p className="summary-warning">Address needs verification · location may be approximate or unavailable</p>}
      {cancellation&&<p className="summary-warning">{cancellation}</p>}
      <p className="summary-work"><strong>Work</strong>{work.length>180?work.slice(0,180)+'…':work||'Work not recorded'}</p>
      <p className="summary-payment"><strong>{payment.label}</strong>{payment.amount&&<span>{payment.amount}</span>}{payment.balance&&<span>{payment.balance}</span>}{payment.details.map(detail=><small key={detail}>{detail}</small>)}</p>
      {(notes.length>0||sourceWork.length>180||sourceWork!==work)&&<details><summary>Request and notes</summary>{sourceWork&&<p>{sourceWork}</p>}{notes.map((note,index)=><p key={index}>{note}</p>)}</details>}
    </div>
    <footer><button type="button" onClick={close}>Close</button><button type="button" className="summary-full-details" onClick={openDetails}>Full details</button></footer>
  </dialog>;
}
