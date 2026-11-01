import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Expand, TriangleAlert, X } from 'lucide-react';
import type { HoursDay, HoursWeek } from './lib/krewe-hours-contract';
import type { DesktopCrewMember } from './lib/people-fleet-contract';
import { missingPunch } from './lib/missing-punch';
import { payForDays } from './lib/krewe-pay-breakdown';
import './krewe-week-overview.css';

const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
const hoursLabel = (value: number | null) => value === null ? 'Hours unknown' : `${value.toLocaleString('en-US', {maximumFractionDigits:2})} hrs`;
const payLabel = (value: number | null) => value === null ? 'Pay unknown' : value.toLocaleString('en-US', {style:'currency',currency:'USD'});

export default function KreweWeekOverview({name,week,weekNumber,days,payrollVisible,renderDetails,onPrevious,onNext}: {
  name:string; week:HoursWeek; weekNumber:number; days:DesktopCrewMember['days']; payrollVisible:boolean;
  renderDetails:(day:HoursDay,closeWeek:()=>void)=>ReactNode; onPrevious?:()=>void; onNext?:()=>void;
}) {
  const [fullWeek,setFullWeek]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const opener=useRef<HTMLButtonElement>(null);
  useEffect(()=>{ if(fullWeek) dialog.current?.showModal(); },[fullWeek]);
  const close=()=>{dialog.current?.close();setFullWeek(false);opener.current?.focus();};
  const range=`${dateLabel(week.start,{month:'short',day:'numeric'})} – ${dateLabel(week.end,{month:'short',day:'numeric'})}`;
  const rows=(inDialog:boolean)=><div className="crew-week-days" key={week.start} aria-label={`Week ${weekNumber} daily summaries`}>{week.days.map(day=>{
    const evidence=days.find(record=>record.date===day.date);
    const punch=missingPunch(day,evidence);
    const pay=payForDays(days,day.date,day.date);
    const status=punch.label || `${day.status}${day.corrected?' · Corrected':''}`;
    return <details className={`crew-week-day${punch.label?' has-missing-punch':''}`} key={day.date}>
      <summary className="crew-week-day-summary" aria-label={`${dateLabel(day.date,{weekday:'long',month:'long',day:'numeric'})}: ${status}; ${hoursLabel(day.hours)}${payrollVisible?`; ${payLabel(pay.totalPay)}`:''}. Show day details`}>
        <span className="crew-week-date"><strong>{dateLabel(day.date,{weekday:'short'})}</strong><span>{dateLabel(day.date,{month:'short',day:'numeric'})}</span></span>
        <span className="crew-week-status">{punch.label&&<TriangleAlert size={16} aria-hidden="true"/>}<span>{status}</span></span>
        <span className="crew-week-amounts"><strong>{hoursLabel(day.hours)}</strong>{payrollVisible&&<span>{payLabel(pay.totalPay)}</span>}</span>
        <ChevronDown className="crew-week-chevron" size={14} aria-hidden="true"/>
      </summary>
      {renderDetails(day,inDialog?close:()=>{})}
    </details>;
  })}</div>;
  return <div className="crew-week-overview">
    <header><div><h4>All 7 days</h4><span>{range} · Tap a day for details</span></div><button type="button" ref={opener} onClick={()=>setFullWeek(true)} aria-label={`Show all 7 days full screen for ${name}`}><Expand size={16} aria-hidden="true"/><span>Full week</span></button></header>
    {rows(false)}
    {fullWeek&&<dialog ref={dialog} className="crew-full-week" aria-label={`${name} full week`} onClose={()=>{setFullWeek(false);opener.current?.focus();}}>
      <header className="crew-full-week-heading"><div><strong>{name}</strong><span>All 7 days · Tap a day for details</span></div><button type="button" onClick={close} aria-label="Close full week"><X size={20}/></button></header>
      <nav className="crew-full-week-nav" aria-label="Choose week"><button type="button" disabled={!onPrevious} onClick={onPrevious} aria-label="Previous week"><ChevronLeft size={18}/></button><strong>Week {weekNumber} · {range}</strong><button type="button" disabled={!onNext} onClick={onNext} aria-label="Next week"><ChevronRight size={18}/></button></nav>
      {rows(true)}
    </dialog>}
  </div>;
}
