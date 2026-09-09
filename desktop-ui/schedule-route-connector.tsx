import { useId } from 'react';
import { unavailableRoute, type ScheduleAppointment } from './lib/schedule-contract';
import type { TimelineConnector } from './lib/schedule-travel-layout';
import './schedule-route-connector.css';

export default function ScheduleRouteConnector({ connector: c, jobs, select }: { connector: TimelineConnector; jobs: ScheduleAppointment[]; select: (id: string) => void }) {
  const id = useId();
  const { leg } = c;
  const unavailable = unavailableRoute(leg, jobs);
  const estimate = leg.travelMinutes === null ? unavailable.label : `${leg.travelMinutes}m${leg.miles === null ? '' : ` · ${leg.miles}mi`}`;
  const label = `${leg.fromJk} → ${leg.toJk}: ${estimate} · Proposed order`;
  return <>
    <div className={`schedule-route-connector ${c.vertical ? 'vertical' : 'horizontal'}${c.reverse ? ' reverse' : ''}${leg.travelMinutes === null ? ' unavailable' : ''}`} style={{ left: `${c.left * 100}%`, width: `${c.width * 100}%`, top: c.top, height: c.height }}>
      <i className="route-connector-line" aria-hidden="true" /><i className="route-connector-arrow" aria-hidden="true">{c.vertical ? c.reverse ? '↑' : '↓' : c.reverse ? '←' : '→'}</i>
      <button type="button" className="route-connector-label" style={{ top: c.labelTop }} popoverTarget={id} title={label} aria-label={label}>
        {leg.travelMinutes === null ? <span>ETA ?</span> : <><span>{leg.travelMinutes}m</span>{leg.miles !== null && <span className="route-connector-miles"> · {leg.miles}mi</span>}</>}
      </button>
    </div>
    <div id={id} popover="auto" className="schedule-route-popover" role="dialog" aria-labelledby={`${id}-title`}>
      <header><h3 id={`${id}-title`}>Travel · {leg.truck}</h3><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="Close travel details">×</button></header>
      <div className="route-connector-records">{[c.from, c.to].map((item, index) => <div key={item.job.recordId}><span>{index + 1}</span><button type="button" onClick={event => { event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover(); select(item.job.recordId); }}>{item.job.jkNumber}</button><small>{item.job.appointmentTime}</small></div>)}</div>
      <strong>{estimate}</strong><p>Proposed order · {c.vertical ? 'Overlapping appointment windows' : leg.gapMinutes === 0 ? 'Adjacent appointment windows' : 'Between appointment windows'}.</p>
      <p>{leg.travelMinutes === null ? unavailable.detail : 'Estimated road travel without live traffic. Appointment windows do not establish service duration or available buffer time.'}</p>
    </div>
  </>;
}
