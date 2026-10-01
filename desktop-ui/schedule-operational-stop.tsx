import type { ScheduleOperationalStop } from './lib/schedule-contract';

const clock = (minute: number) => new Date(Date.UTC(2000, 0, 1, 0, Math.floor(minute))).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });

export default function ScheduleOperationalStopBlock({ stop, range, top }: {
  stop: ScheduleOperationalStop;
  range: { start: number; duration: number };
  top: number;
}) {
  const left = (stop.startMinutes - range.start) / range.duration;
  const width = Math.max(0, stop.endMinutes - stop.startMinutes) / range.duration;
  const point = stop.endMinutes === stop.startMinutes;
  const time = point ? clock(stop.startMinutes) : `${clock(stop.startMinutes)}–${stop.ongoing ? 'latest report' : clock(stop.endMinutes)}`;
  const detail = stop.kind === 'departure'
    ? `${stop.truck} departed ${stop.name} at ${time}. Arrival was before this operating day.`
    : `${stop.truck} visited ${stop.name} · ${time}${stop.ongoing ? ' · departure unconfirmed' : ''}. Source: LinxUp facility evidence.`;
  return <div className={`schedule-operational-stop is-${stop.kind}${point ? ' is-point' : ''}`}
    style={{ left:`${left * 100}%`, width:`max(${point ? 76 : 42}px, ${width * 100}%)`, top }}
    role="note" aria-label={detail} title={detail}
    data-operational-stop={stop.kind} data-operational-location={stop.name}>
    <span>{stop.label}</span>
  </div>;
}
