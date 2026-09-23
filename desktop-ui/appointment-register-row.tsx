import { truckDisplayText } from '../lib/junkware-trucks';
import {appointmentServiceAddress} from '../lib/service-address-format';
import { completedOnsiteClockRange } from '../lib/appointment-onsite-time';
import { appointmentCategory, appointmentStatus, assignmentNeedsVerification, displayedOnsiteTime, scheduleCustomerLabel, scheduleDisplayTruck, scheduleTruckMismatch, truckLabel, type ScheduleAppointment } from './lib/schedule-contract';
import { schedulePayment } from './lib/schedule-payment';
import { appointmentPartner, serviceAddressForGeocoding } from '../lib/appointment-partner';
import './appointment-register.css';
import { SourceEstimateSummary } from './source-estimate';

export function AppointmentRegisterRow({ job, selected, area, warning, route, proximity, select, open }: {
  job: ScheduleAppointment; selected: boolean; area: string; warning?: string; route?: string; proximity?: string | null;
  select: () => void; open: () => void;
}) {
  const status = appointmentStatus(job);
  const payment = schedulePayment(job);
  const displayTime = displayedOnsiteTime(job);
  const onsiteMinutes = displayTime?.minutes;
  const onsiteLabel = onsiteMinutes != null && Number.isFinite(onsiteMinutes) && onsiteMinutes >= 0
    ? `${onsiteMinutes < 1 ? '<1' : Math.round(onsiteMinutes)} min on site`
    : 'Time unavailable';
  const onsiteClocks = status === 'Completed' ? completedOnsiteClockRange(displayTime) : null;
  const truckMismatch = scheduleTruckMismatch(job);
  const partner = appointmentPartner(job);
  const digits = job.phone.replace(/\D/g, '');
  const crew = [job.driver, job.navigator, ...(job.additionalCrew || [])].filter(value => value && value !== '—').join(' · ');
  const work = (job.pickupItems?.length ? job.pickupItems : job.junkItems).join(' · ') || 'Work not recorded';
  const atJobGps = job.truckAtJob && job.atJobGpsAt && Number.isFinite(Date.parse(job.atJobGpsAt)) ? new Date(job.atJobGpsAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}) : null;
  return <article className={`appointment-register-row readable-appointment ${status.toLowerCase().replaceAll(' ', '-')}${selected ? ' route-selected' : ''}`} role="row" aria-selected={selected} onClick={event => { if (!(event.target as HTMLElement).closest('a,button')) select(); }}>
    <div className="register-identity" role="cell"><span className="register-mobile-label">Appointment</span><strong>{job.appointmentTime || 'Time not set'}</strong><button className="jk-record-link" onClick={select}>{job.jkNumber || 'JK pending'}</button><small>{appointmentCategory(job)}</small>{partner && <span className="appointment-partner-badge">{partner.name}</span>}</div>
    <div className="register-customer" role="cell"><span className="register-mobile-label">Customer & work</span><strong>{scheduleCustomerLabel(job)}</strong>{job.address ? <a className="register-address" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(serviceAddressForGeocoding(appointmentServiceAddress(job)))}`} target="_self" rel="noopener noreferrer">{appointmentServiceAddress(job)}</a> : <span>Address unavailable</span>}<small>{area}</small>{digits.length >= 7 && <a href={`tel:+${digits.length === 10 ? '1' : ''}${digits}`}>{job.phone}</a>}<span className="register-work" title={work}>{work}</span>{warning && <small className="register-warning">{warning}</small>}</div>
    <div className="register-assignment" role="cell"><span className="register-mobile-label">Assignment</span><strong>{truckDisplayText(scheduleDisplayTruck(job))}</strong><small>{crew || 'Crew not recorded'}</small>{truckMismatch && <small className="register-warning">GPS confirmed · JunkWare says {truckDisplayText(truckMismatch.junkwareTruck)}</small>}{assignmentNeedsVerification(job) && <small className="register-warning">Assignment not verified</small>}{job.truckOnSite && job.onsiteTruck && truckLabel(job.onsiteTruck) !== truckLabel(job.truck) && <small>{job.onsiteTruck} on site</small>}</div>
    <div className={`register-payment payment-${payment.tone}`} role="cell" aria-label={`Payment for ${job.jkNumber}`}><SourceEstimateSummary job={job} /><span className="register-payment-label">{payment.label}</span>{payment.amount && <strong className="register-payment-amount">{payment.amount}</strong>}<div className="register-payment-summary">{payment.details.map(detail => <span className="register-payment-detail" key={detail}>{detail}</span>)}{payment.balance && <span className="register-payment-balance">{payment.balance}</span>}</div></div>
    <div className="register-status" role="cell"><span className={`appointment-state ${status.toLowerCase().replaceAll(' ', '-')}`}>{status === 'Completed' || status === 'Estimate Closed' ? '✓ ' : ''}{status}{status === 'Completed' && <span className="register-onsite-time" title={displayTime?.label || 'No confirmed on-site duration'}> · {onsiteLabel}</span>}</span>{job.truckAtJob && <small><b>{truckDisplayText(job.atJobTruck || job.truck)} at job</b><br />Parked report{atJobGps ? ` ${atJobGps}` : ''} · arrival and duration unconfirmed</small>}{onsiteClocks && <small>{onsiteClocks}</small>}{proximity && <small>{proximity}</small>}{status === 'Canceled' && job.cancellationReason && <small className="register-cancellation-reason" title={job.cancellationReason}><b>Cancellation reason</b><br />{job.cancellationReason}</small>}<button className="register-open" aria-label={`View details for ${job.jkNumber}`} onClick={open}>View details →{job.appointmentNotes.length > 0 && <span className="register-note-count"> · {job.appointmentNotes.length} {job.appointmentNotes.length === 1 ? 'note' : 'notes'}</span>}</button>{route && <small className="register-route" title={route}>{route}</small>}</div>
  </article>;
}
