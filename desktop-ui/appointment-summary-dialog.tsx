import { useEffect, useRef } from 'react';
import { SheetDismissHandle } from './components/mobile-interactions';
import { appointmentServiceAddress } from '../lib/service-address-format';
import { truckDisplayText } from '../lib/junkware-trucks';
import { appointmentCategory, appointmentStatus, assignmentNeedsVerification, needsScheduleAddressVerification, scheduleCustomerLabel, scheduleDisplayTruck, scheduleTruckMismatch, type ScheduleAppointment } from './lib/schedule-contract';
import { schedulePayment } from './lib/schedule-payment';
import './appointment-summary-dialog.css';

/** Snapshot-only preview: operational components mount only after Full details. */
export function AppointmentSummaryDialog({job,date,close,openDetails,returnFocus}: {job:ScheduleAppointment;date:string;close:()=>void;openDetails:()=>void;returnFocus:HTMLElement|null}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const latest=useRef(close);latest.current=close;
  const origin=useRef(returnFocus);
  useEffect(()=>{const node=dialog.current,previous=origin.current;node?.showModal();return()=>{node?.close();if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
  const payment=schedulePayment(job),mismatch=scheduleTruckMismatch(job);
  const work=(job.pickupItems?.length?job.pickupItems:job.junkItems).join(' · ');
  const notes=job.appointmentNotes.map(note=>note.trim()).filter(Boolean);
  return <dialog ref={dialog} className="appointment-summary-dialog" aria-labelledby="appointment-summary-title" onCancel={event=>{event.preventDefault();latest.current();}} onClick={event=>{if(event.target===event.currentTarget)close();}}>
    <SheetDismissHandle label="Close summary" onDismiss={close}/>
    <header><div><p>{appointmentCategory(job)} · {appointmentStatus(job)}</p><h2 id="appointment-summary-title">{scheduleCustomerLabel(job)}</h2><p>{job.jkNumber} · {date}</p></div><button type="button" aria-label="Close appointment summary" onClick={close}>×</button></header>
    <div className="appointment-summary-content">
      <dl><div><dt>Time</dt><dd>{job.appointmentTime||'Time not recorded'}</dd></div><div><dt>Truck</dt><dd>{truckDisplayText(scheduleDisplayTruck(job))}</dd></div><div className="summary-wide"><dt>Service address</dt><dd>{appointmentServiceAddress(job)||'Address unavailable'}</dd></div></dl>
      {assignmentNeedsVerification(job)&&<p className="summary-warning">Assignment not verified</p>}
      {mismatch&&<p className="summary-warning">GPS confirmed · JunkWare says {truckDisplayText(mismatch.junkwareTruck)}</p>}
      {needsScheduleAddressVerification(job)&&<p className="summary-warning">Address needs verification · location may be approximate or unavailable</p>}
      {job.cancellationReason&&<p className="summary-warning">Cancellation reason: {job.cancellationReason}</p>}
      <p className="summary-work"><strong>Work</strong>{work.length>180?work.slice(0,180)+'…':work||'Work not recorded'}</p>
      <p className="summary-payment"><strong>{payment.label}</strong>{payment.amount&&<span>{payment.amount}</span>}{payment.balance&&<span>{payment.balance}</span>}{payment.details.map(detail=><small key={detail}>{detail}</small>)}</p>
      {(notes.length>0||work.length>180)&&<details><summary>Request and notes</summary>{work.length>180&&<p>{work}</p>}{notes.map((note,index)=><p key={index}>{note}</p>)}</details>}
    </div>
    <footer><button type="button" onClick={close}>Close</button><button type="button" className="summary-full-details" onClick={openDetails}>Full details</button></footer>
  </dialog>;
}
