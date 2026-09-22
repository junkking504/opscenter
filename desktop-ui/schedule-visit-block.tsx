import { truckDisplayText } from '../lib/junkware-trucks';
import { Check, GripVertical, X } from 'lucide-react';
import type { PointerEvent } from 'react';
import { appointmentPartner } from '../lib/appointment-partner';
import { appointmentCategory, appointmentColorClass, appointmentStatus, isClosed, scheduleMoveRestriction, scheduleStatusTone, timelinePlacement, type ScheduleAppointment } from './lib/schedule-contract';

const clock = (minute:number) => new Date(Date.UTC(2000,0,1,0,Math.floor(minute))).toLocaleTimeString('en-US',{timeZone:'UTC',hour:'numeric',minute:'2-digit'});
export default function ScheduleVisitBlock({job,truck,position,segmentIndex,top,selected,muted,matched,dragging,busy,onPointerDown,onSelect}: {
  job:ScheduleAppointment; truck:string; position:NonNullable<ReturnType<typeof timelinePlacement>>; segmentIndex:number; top:number;
  selected:boolean; muted:boolean; matched:boolean; dragging:boolean; busy:boolean; onPointerDown:(event:PointerEvent<HTMLDivElement>)=>void; onSelect:()=>void;
}) {
  const interval=position.intervals[segmentIndex],segment=position.segments[segmentIndex];
  const tone=position.actual ? interval.ongoing?'on-site':isClosed(job)?scheduleStatusTone(job):'visited' : scheduleStatusTone(job);
  const state=position.actual ? interval.ongoing?'On site':interval.complete?'Recorded visit':'Departure unconfirmed' : appointmentStatus(job);
  const partner=appointmentPartner(job);
  const movable=(!position.actual || /^confirmed$/i.test(job.status)) && !scheduleMoveRestriction(job) && !busy;
  const description=position.actual ? movable ? 'Recorded truck visit. Drag to assign this open appointment; the visit history stays unchanged.' : 'Recorded truck visit. Click to open appointment details.' : scheduleMoveRestriction(job) || 'Drag to change truck or time; click to open appointment details.';
  const minutes=interval.end-interval.start;
  const time=position.actual ? `${clock(interval.start)}–${interval.ongoing?'now':clock(interval.end)} · ${minutes<1?'<1':Math.round(minutes)} min on site` : `${job.appointmentTime} · Planned booked window`;
  const label=`${job.jkNumber} · ${job.customerName} · ${truckDisplayText(truck)} · ${time} · ${state}${partner?` · ${partner.name}`:''}`;
  return <div className={`schedule-appointment status-${tone} ${appointmentColorClass(job)} ${appointmentCategory(job).toLowerCase()}${muted?' scope-muted':''}${matched?' scope-match':''}${selected?' route-selected':''}${dragging?' is-dragging':''}`}
    style={{left:`${segment.left*100}%`,width:`max(${partner?34:22}px, ${segment.width*100}%)`,top,height:22}}
    role="button" tabIndex={0} aria-pressed={selected} aria-label={label} title={`${label}. ${description}`}
    aria-roledescription={movable?'draggable appointment':undefined} data-schedule-appointment={job.recordId} data-time-basis={position.actual?'actual':'booked'}
    data-visit-truck={position.actual?truck:undefined} data-visit-start={interval.start} data-visit-end={interval.end}
    onPointerDown={movable?onPointerDown:undefined} onClick={onSelect} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect();}}}>
    {partner && <span className="schedule-partner-cue" title={partner.name} aria-hidden="true"/>}
    {movable && <GripVertical className="schedule-grip" size={9} aria-hidden="true"/>}
    <em title={state} style={partner?{paddingLeft:12,boxSizing:"border-box"}:undefined} className={`schedule-block-status status-${tone}`}>
      {tone==='completed'?<Check size={12} strokeWidth={3} aria-hidden="true"/>:tone==='canceled'?<X size={12} strokeWidth={3} aria-hidden="true"/>:tone==='visited'?<b aria-hidden="true">?</b>:null}
    </em>
  </div>;
}
