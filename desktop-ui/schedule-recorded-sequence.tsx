import { useId } from 'react';
import { groupNearbyHqStops, recordedStopSequence } from './lib/schedule-recorded-sequence';
import { truckDisplayText } from '../lib/junkware-trucks';
import { truckLabel, type ScheduleAppointment, type ScheduleOperationalStop } from './lib/schedule-contract';
import './schedule-recorded-sequence.css';

const clock = (minutes: number) => new Date(Date.UTC(2000,0,1,0,Math.floor(minutes))).toLocaleTimeString('en-US',{timeZone:'UTC',hour:'numeric',minute:'2-digit'});

export default function ScheduleRecordedSequence({ jobs, stops, trucks, now, select }: {
  jobs: ScheduleAppointment[]; stops: ScheduleOperationalStop[]; trucks: string[]; now: number; select: (id: string) => void;
}) {
  const id = useId();
  const rows = trucks.filter(truck=>truck!=='Unassigned').map(truck=>({truck,sequence:recordedStopSequence(jobs,groupNearbyHqStops(stops.filter(stop=>truckLabel(stop.truck)===truckLabel(truck)),jobs,truck,now),truck,now)})).filter(row=>row.sequence.length);
  return <><button type="button" className="schedule-recorded-sequence-button" popoverTarget={id}>Recorded stops</button>
    <div id={id} popover="auto" className="schedule-recorded-sequence" role="dialog" aria-label="Recorded truck stop sequence">
      <header><h3>Recorded stops</h3><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="Close recorded stops">×</button></header>
      <p>Jobs, HQ and facility visits in recorded arrival order. Gaps are elapsed time between records, not measured driving time. Overlapping records need verification.</p>
      {!rows.length && <p>No recorded visits available.</p>}
      {rows.map(({truck,sequence}) => {
        return <section key={truck}><h4>{truckDisplayText(truck)}</h4>{sequence.length ? <ol>{sequence.map((stop,index) => {
          const priorEnd = index ? Math.max(...sequence.slice(0,index).map(prior=>prior.end)) : null;
          const gap = priorEnd === null ? null : stop.start-priorEnd;
          return <li key={stop.id}>{gap !== null && <small>{gap < 0 ? 'Overlapping records · verify sequence' : `→ ${Math.round(gap)}m between records`}</small>}
            <div><time>{clock(stop.start)}–{stop.ongoing ? 'latest report' : clock(stop.end)}</time>
              {stop.appointmentId ? <button type="button" onClick={event=>{event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();select(stop.appointmentId!);}}>{stop.label}</button> : <strong>{stop.label}</strong>}
              {stop.groupedVisits && <small>{stop.groupedVisits} nearby HQ records grouped</small>}
            </div></li>;
        })}</ol> : <p>No recorded visits available.</p>}</section>;
      })}
    </div></>;
}
