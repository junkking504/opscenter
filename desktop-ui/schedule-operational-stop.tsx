import type { ScheduleOperationalStop } from './lib/schedule-contract';
import { operationalStopIcon, stopMinimumWidth } from './lib/schedule-operational-stop-layout';

const clock = (minute: number) => new Date(Date.UTC(2000, 0, 1, 0, Math.floor(minute))).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
const duration = (start: string | null, end: string | null) => {
  const milliseconds = Date.parse(end || '') - Date.parse(start || '');
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  const minutes = Math.round(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ''}` : `${minutes}m`;
};

export default function ScheduleOperationalStopBlock({ stop, range, top }: {
  stop: ScheduleOperationalStop;
  range: { start: number; duration: number };
  top: number;
}) {
  const left = (stop.startMinutes - range.start) / range.duration;
  const width = Math.max(0, stop.endMinutes - stop.startMinutes) / range.duration;
  const point = stop.endMinutes === stop.startMinutes;
  const time = point ? clock(stop.startMinutes) : `${clock(stop.startMinutes)}–${stop.ongoing ? 'latest report' : clock(stop.endMinutes)}`;
  const visitDuration = stop.kind === 'hq' ? duration(stop.enteredAt, stop.departedAt || stop.observedThrough) : '';
  const detail = `${stop.label} · ${time}${visitDuration ? ` · ${visitDuration}` : ''}`;
  const icon = operationalStopIcon(stop);
  return <div className={`schedule-operational-stop is-${stop.kind}${point ? ' is-point' : ''}`}
    style={{ left:`${left * 100}%`, width:`max(${stopMinimumWidth(stop)}px, ${width * 100}%)`, top }}
    role="note" aria-label={detail} title={detail}
    data-operational-stop={stop.kind} data-operational-location={stop.name} data-operational-icon={icon || undefined}>
    {icon ? <><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {icon === 'house' ? <path d="M3 11 12 3l9 8M5 10v11h14V10M10 21v-7h4v7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        : icon === 'dump' ? <><path d="m2 20 4-5 3-2 3-7 4 5 2 1 4 8Z" fill="currentColor" opacity=".8" /><path d="m7 18 3-3m3-4 2 3m1 3 2 1M2 21h20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>
          : <path d="M4 3h16v4h-6v10h6v4H4v-4h6V7H4V3Z" fill="currentColor" />}
    </svg></> : <span>{stop.label}</span>}
  </div>;
}
