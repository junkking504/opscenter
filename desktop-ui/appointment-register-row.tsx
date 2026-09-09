import { appointmentCategory, appointmentStatus, assignmentNeedsVerification, truckLabel, type ScheduleAppointment } from './lib/schedule-contract';
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
  const partner = appointmentPartner(job);
  const digits = job.phone.replace(/\D/g, '');
  const crew = [job.driver, job.navigator, ...(job.additionalCrew || [])].filter(value => value && value !== '—').join(' · ');
  return <article className={`appointment-register-row readable-appointment ${status.toLowerCase().replaceAll(' ', '-')}${selected ? ' route-selected' : ''}`} role="row" aria-selected={selected} onClick={event => { if (!(event.target as HTMLElement).closest('a,button')) select(); }}>
    <div className="register-identity" role="cell"><span className="register-mobile-label">Appointment</span><strong>{job.appointmentTime || 'Time not set'}</strong><button className="jk-record-link" onClick={select}>{job.jkNumber || 'JK pending'}</button><small>{appointmentCategory(job)}</small>{partner && <span className="appointment-partner-badge">{partner.name}</span>}</div>
    <div className="register-customer" role="cell"><span className="register-mobile-label">Customer & work</span><strong>{job.customerName || 'Customer unavailable'}</strong>{job.address ? <a className="register-address" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(serviceAddressForGeocoding(job.address))}`} target="_blank" rel="noopener noreferrer">{job.address}</a> : <span>Address unavailable</span>}<small>{area}</small>{digits.length >= 7 && <a href={`tel:+${digits.length === 10 ? '1' : ''}${digits}`}>{job.phone}</a>}<span className="register-work">{(job.pickupItems?.length ? job.pickupItems : job.junkItems).join(' · ') || 'Work not recorded'}</span>{warning && <small className="register-warning">{warning}</small>}</div>
    <div className="register-assignment" role="cell"><span className="register-mobile-label">Assignment</span><strong>{truckLabel(job.truck)}</strong><small>{crew || 'Crew not recorded'}</small>{assignmentNeedsVerification(job) && <small className="register-warning">Assignment not verified</small>}{job.truckOnSite && job.onsiteTruck && truckLabel(job.onsiteTruck) !== truckLabel(job.truck) && <small>{job.onsiteTruck} on site</small>}</div>
    <div className={`register-payment payment-${payment.tone}`} role="cell" aria-label={`Payment for ${job.jkNumber}`}><SourceEstimateSummary job={job} /><span className="register-payment-label">{payment.label}</span>{payment.amount && <strong className="register-payment-amount">{payment.amount}</strong>}{payment.details.map(detail => <span className="register-payment-detail" key={detail}>{detail}</span>)}{payment.balance && <span className="register-payment-balance">{payment.balance}</span>}</div>
    <div className="register-status" role="cell"><span className={`appointment-state ${status.toLowerCase().replaceAll(' ', '-')}`}>{status === 'Completed' || status === 'Estimate Closed' ? '✓ ' : ''}{status}</span>{proximity && <small>{proximity}</small>}{status === 'Canceled' && job.cancellationReason && <small>{job.cancellationReason}</small>}<button className="register-open" aria-label={`View details for ${job.jkNumber}`} onClick={open}>View details →</button>{job.appointmentNotes.length > 0 && <small>{job.appointmentNotes.length} {job.appointmentNotes.length === 1 ? 'note' : 'notes'} in details</small>}{route && <small className="register-route">{route}</small>}</div>
  </article>;
}
