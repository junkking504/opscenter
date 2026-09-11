import { useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { currentOperatingDay, isOperatingDay, operatingDayLabel, shiftOperatingDay } from './lib/operating-day';
import './operating-day-bar.css';

export default function OperatingDayBar({ date, disabled, onChange }: {
  date: string; disabled: boolean; onChange: (date: string) => void;
}) {
  const [draft, setDraft] = useState(date);
  const barRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    const content = bar?.parentElement;
    if (!bar || !content) return;
    const measure = () => content.style.setProperty('--viewing-day-height', `${bar.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => { observer.disconnect(); content.style.removeProperty('--viewing-day-height'); };
  }, []);
  const today = currentOperatingDay();
  const context = date === today ? 'Today' : date < today ? 'Historical day' : 'Upcoming day';
  return <section ref={barRef} className="viewing-day-bar" aria-label="Viewing day">
    <div className="viewing-day-context">
      <CalendarDays size={20} aria-hidden="true" />
      <div><span>Viewing day <b className={date === today ? 'current' : ''}>{context}</b></span><strong>{operatingDayLabel(date)}</strong></div>
    </div>
    <div className="viewing-day-controls">
      <button type="button" aria-label="Previous day" title="Previous day" disabled={disabled} onClick={() => onChange(shiftOperatingDay(date, -1))}><ChevronLeft size={18} /></button>
      <form onSubmit={event => { event.preventDefault(); if (!disabled && isOperatingDay(draft) && draft !== date) onChange(draft); }}>
        <input aria-label="Choose operating day" type="date" value={draft} disabled={disabled} required onChange={event => setDraft(event.target.value)} />
        <button type="submit" disabled={disabled || !isOperatingDay(draft) || draft === date}>Go</button>
      </form>
      <button type="button" aria-label="Next day" title="Next day" disabled={disabled} onClick={() => onChange(shiftOperatingDay(date, 1))}><ChevronRight size={18} /></button>
      <button type="button" disabled={disabled || date === today} onClick={() => onChange(today)}>Today</button>
    </div>
  </section>;
}
