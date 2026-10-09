import { truckDisplayText } from '../lib/junkware-trucks';
import { useId } from 'react';
import { unavailableRoute, type ScheduleAppointment } from './lib/schedule-contract';
import type { TimelineConnector } from './lib/schedule-travel-layout';
import './schedule-route-connector.css';

export default function ScheduleRouteConnector({ connector: c, jobs, select }: { connector: TimelineConnector; jobs: ScheduleAppointment[]; select: (id: string) => void }) {
  const id = useId();
  const { leg } = c;
  const unavailable = unavailableRoute(leg, jobs);
  const estimate = leg.travelMinutes === null ? unavailable.label : `${leg.travelMinutes}m`;
  const hoverEstimate = leg.travelMinutes === null ? unavailable.label : `${leg.travelMinutes} min`;
  const completed = /complet|closed/i.test(c.from.job.status || '') && /complet|closed/i.test(c.to.job.status || '');
  const orderLabel = completed ? 'Completed stops' : c.from.job.visitOrder !== undefined || c.to.job.visitOrder !== undefined || c.from.job.stopOrder !== undefined || c.to.job.stopOrder !== undefined ? 'Saved job order' : 'Proposed order';
  const label = `${leg.fromJk} → ${leg.toJk}: ${estimate} · ${orderLabel}`;
  return <>
    <div className={`schedule-route-connector compact-travel${leg.travelMinutes === null ? ' unavailable' : ''}`} data-route-from={leg.fromAppointmentId} data-route-to={leg.toAppointmentId} style={{ left: `${c.left * 100}%`, width: `${c.width * 100}%`, top: c.top, height: c.height }}>
      <svg className="route-connector-path" viewBox={`0 0 100 ${c.height}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={c.path} /></svg>
      <i className="route-connector-arrow" style={{left:`${c.arrowLeft}%`,top:c.arrowTop}} aria-hidden="true">{c.arrow}</i>
      <button type="button" className="route-connector-label" style={{top:c.labelTop,left:`${(c.labelLeft-c.left)*100/c.width}%`,width:`${c.labelWidth*100/c.width}%`}} popoverTarget={id} title={`${c.from.job.customerName || leg.fromJk} → ${c.to.job.customerName || leg.toJk}: ${hoverEstimate} · ${orderLabel}`} aria-label={label}>
        {leg.travelMinutes === null ? 'ETA ?' : `${leg.travelMinutes}m`}
      </button>
    </div>
    <div id={id} popover="auto" className="schedule-route-popover" role="dialog" aria-labelledby={`${id}-title`}>
      <header><h3 id={`${id}-title`}>Travel · {truckDisplayText(leg.truck)}</h3><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="Close travel details">×</button></header>
      <div className="route-connector-records">{[c.from, c.to].map((item, index) => <div key={item.job.recordId}><span>{index + 1}</span><button type="button" onClick={event => { event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover(); select(item.job.recordId); }}>{item.job.jkNumber}</button><small>{item.job.customerName}<br />{item.job.appointmentTime}</small></div>)}</div>
      <strong>{estimate}</strong><p>{orderLabel}. Customer appointment windows remain as booked.</p>
      <p>{leg.travelMinutes === null ? unavailable.detail : 'Estimated road travel without live traffic. Appointment windows do not establish service duration or available buffer time.'}</p>
    </div>
  </>;
}
