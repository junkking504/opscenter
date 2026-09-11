import type { ScheduleAppointment } from './lib/schedule-contract';
import { AlertPhotos } from './components/alert-details';
import './source-estimate.css';

export function SourceEstimateSummary({ job, showPhotos = false }: { job: ScheduleAppointment; showPhotos?: boolean }) {
  if (!/^\d+$/.test(job.sourceEstimateAppointmentId || '') || /estimate/i.test(job.appointmentType)) return null;
  const estimate = job.sourceEstimate;
  return <section className="source-estimate" aria-label="Prior estimate">
    <strong>Prior estimate{estimate?.total != null ? ` · ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(estimate.total)}` : ' · quote unavailable'}</strong>
    {estimate?.chargeSummary && <span>{estimate.chargeSummary}</span>}
    <a href={`https://junkware.junk-king.com/franchise/appointment.aspx?id=${job.sourceEstimateAppointmentId}`} target="_self" rel="noopener noreferrer">View estimate {estimate?.jkNumber || job.sourceEstimateAppointmentId} ↗</a>
    {estimate?.date && <small>Quoted {estimate.date} · not a payment</small>}
    {estimate?.photos.length ? <small>{estimate.photos.length} estimate photos{showPhotos ? '' : ' in details'}</small> : <small>{estimate?.photoAuditAvailable ? 'No photos recorded on the estimate' : 'Estimate photos unavailable in this snapshot'}</small>}
    {showPhotos && <AlertPhotos photos={estimate?.photos} />}
  </section>;
}
