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
  const orderLabel = completed ? 'Completed stops' : c.from.job.visitOrder !== undefined || c.to.job.visitOrder !== undefined || c.from.job.stopOrder !== undefined || c.to.job.stopOrder !== undefined ? 'Saved stop order' : 'Proposed order';
  const label = `${leg.fromJk} → ${leg.toJk}: ${estimate} · ${orderLabel}`;
  return <>
    <div className={`schedule-route-connector travel-sequence-item${leg.travelMinutes === null ? ' unavailable' : ''}`} data-route-from={leg.fromAppointmentId} data-route-to={leg.toAppointmentId} style={{ left: `${c.labelLeft * 100}%`, width: `${c.labelWidth * 100}%`, top: c.top+c.labelTop, height: 38 }}>
      <button type="button" className="route-connector-label" popoverTarget={id} title={`${c.from.job.customerName || leg.fromJk} → ${c.to.job.customerName || leg.toJk}: ${hoverEstimate} · ${orderLabel}`} aria-label={label}>
        <span className="travel-sequence-endpoints">{c.from.job.customerName || leg.fromJk} → {c.to.job.customerName || leg.toJk}</span>
        <span className="travel-sequence-estimate"><b>{leg.travelMinutes === null ? 'ETA unavailable' : `${leg.travelMinutes} min`}</b> · {orderLabel}</span>
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
