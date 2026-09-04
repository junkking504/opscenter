import { useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './components/ui/button';
import LiveSchedule from './live-schedule';
import './command-map.css';

const preferenceKey = 'opscenter.commandMap.expanded';
const keepDay = () => {};

export default function CommandMap({ date, busy, report, onBusyChange, openSchedule }: {
  date: string;
  busy: boolean;
  report: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
  openSchedule: () => void;
}) {
  const [expanded, setExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem(preferenceKey);
      if (saved === 'true' || saved === 'false') return saved === 'true';
    } catch { /* The map remains usable when browser storage is unavailable. */ }
    return !window.matchMedia('(max-width: 720px)').matches;
  });
  const toggle = () => {
    if (busy) return;
    const next = !expanded;
    setExpanded(next);
    try { localStorage.setItem(preferenceKey, String(next)); } catch { /* Optional preference. */ }
  };
  return <section className="command-map" aria-labelledby="command-map-title">
    <header className="command-map-heading">
      <div><span className="section-kicker">Appointments & trucks</span><h2 id="command-map-title">Operations Map</h2></div>
      <div className="command-map-actions">
        <Button variant="ghost" size="sm" disabled={busy} onClick={openSchedule}>Open Schedule <ArrowRight size={13} /></Button>
        <Button variant="outline" size="sm" disabled={busy} aria-expanded={expanded} aria-controls="command-map-body" onClick={toggle}>{expanded ? 'Hide Map' : 'Show Map'}{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</Button>
      </div>
    </header>
    <div id="command-map-body" hidden={!expanded}>
      {expanded && <LiveSchedule mapOnly baseDate={date} day="today" onDayChange={keepDay} report={report} onBusyChange={onBusyChange} />}
    </div>
  </section>;
}
