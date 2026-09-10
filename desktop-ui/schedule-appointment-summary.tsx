import { ArrowRight, MapPin, Phone, Clock3, Truck, X } from 'lucide-react';
import { appointmentPartner, serviceAddressForGeocoding } from '../lib/appointment-partner';
import { appointmentCategory, appointmentStatus, assignmentNeedsVerification, scheduleCustomerLabel, truckLabel, type ScheduleAppointment, type ClosestTruck } from './lib/schedule-contract';
import { schedulePayment } from './lib/schedule-payment';
import './schedule-appointment-summary.css';

export function closestAvailableTruck(candidates: ClosestTruck[]): ClosestTruck | null {
  // Preserve the route service's travel-time ranking; unavailable GPS is never a suggestion.
  return candidates.find(candidate => candidate.status === 'available' && candidate.minutes !== null && Number.isFinite(candidate.minutes) && candidate.minutes >= 0 && candidate.miles !== null && Number.isFinite(candidate.miles) && candidate.miles >= 0) || null;
}
const excerpt = (text: string, length: number) => text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
export default function ScheduleAppointmentSummary({job,closest,loading,isToday,busy,open,clear}: {
  job: ScheduleAppointment; closest: ClosestTruck | null; loading: boolean; isToday: boolean; busy: boolean; open: () => void; clear: () => void;
}) {
  const partner = appointmentPartner(job);
  const status = appointmentStatus(job);
  const items = (job.pickupItems?.length ? job.pickupItems : job.junkItems).join(' · ');
  const notes = job.appointmentNotes.map(note => note.trim()).filter(Boolean);
  const note = status === 'Canceled' && job.cancellationReason ? job.cancellationReason : notes[0];
  const phone = job.phone.replace(/\D/g, '');
  const payment = schedulePayment(job);
  const photos = new Set([...(job.photos || []), ...(job.sourceEstimate?.photos || [])].map(photo => photo.url.split('?')[0])).size;
  return <section className="schedule-appointment-summary" aria-label={`Selected job ${job.jkNumber}`}>
    <div className="selected-job-main">
      <header><div className="selected-job-heading"><span>{job.jkNumber} · {appointmentCategory(job)}</span><h2>{scheduleCustomerLabel(job)}</h2></div><span className="selected-job-status">{status}</span><button className="selected-job-clear" aria-label="Clear appointment selection" disabled={busy} onClick={clear}><X size={17} /></button></header>
      <div className="selected-job-facts"><span><Clock3 size={14} />{job.appointmentTime || 'Time not set'}</span><span><Truck size={14} />{truckLabel(job.truck)}</span>{job.truckOnSite && job.onsiteTruck && truckLabel(job.onsiteTruck) !== truckLabel(job.truck) && <span>{truckLabel(job.onsiteTruck)} on site</span>}{partner && <span className="appointment-partner-badge">{partner.name}</span>}{assignmentNeedsVerification(job) && <strong className="selected-job-warning">Assignment not verified</strong>}</div>
      <div className="selected-job-contact">{job.address ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(serviceAddressForGeocoding(job.address))}`} target="_blank" rel="noopener noreferrer"><MapPin size={14} />{job.address}</a> : <span>Address unavailable</span>}{phone.length >= 7 && <a href={`tel:+${phone.length === 10 ? '1' : ''}${phone}`}><Phone size={14} />{job.phone}</a>}</div>
      <div className="selected-job-work"><b>Work</b><span>{items ? excerpt(items,220) : 'Work not recorded'}</span>{items.length>220&&<button onClick={open} disabled={busy}>Read full description</button>}</div>
      {note && <div className="selected-job-note"><b>{status === 'Canceled' ? 'Canceled' : 'Source note'}</b><span>{excerpt(note,180)}</span><button onClick={open} disabled={busy}>{notes.length>1?`All ${notes.length} notes`:'Read note'}</button></div>}
    </div>
    <aside className="selected-job-next">
      <div className={`selected-job-closest${isToday && job.location && !loading && closest ? ' has-suggestion' : isToday && !job.location ? ' needs-review' : ''}`} aria-live="polite"><span>Closest truck now</span>{!isToday ? <strong>Available for today only</strong> : !job.location ? <strong>Verify address first</strong> : loading ? <strong>Checking distance…</strong> : closest ? <><strong>{truckLabel(closest.truck)} <span>{closest.minutes} min · {closest.miles} mi</span></strong><small>Recent GPS · road estimate. Check availability before assigning.</small></> : <><strong>Unavailable</strong><small>No current GPS and road estimate available.</small></>}</div>
      <div className="selected-job-secondary"><span>{job.callAhead === 'called' ? 'Call ahead recorded' : 'Call ahead not recorded'}</span>{payment.amount && <span>{payment.label} · {payment.amount}</span>}</div>
      <button className="dispatch-full-details" aria-label={`Full details for ${job.jkNumber}`} disabled={busy} onClick={open}>Full details{photos>0?` · ${photos} photos`:''}<ArrowRight size={14} /></button>
    </aside>
  </section>;
}
