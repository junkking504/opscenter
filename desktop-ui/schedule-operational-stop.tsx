import type { ScheduleOperationalStop } from './lib/schedule-contract';
import { operationalStopIcon, stopMinimumWidth } from './lib/schedule-operational-stop-layout';

export const DumpTruckGlyph = () => <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 18h20M15 18v-7h4l3 4v3M18 11v4h4M3 12l8-9 4 4-8 9Z M7 16l5 2" /><circle cx="5" cy="20" r="2" /><circle cx="18" cy="20" r="2" /></g>;

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
  const detail = `${stop.label} · ${time}${stop.groupedVisits ? ` · ${stop.groupedVisits} nearby HQ records grouped; window includes gaps` : visitDuration ? ` · ${visitDuration}` : ''}`;
  const icon = operationalStopIcon(stop);
  const iconOnly = icon === 'house' || icon === 'dump';
  return <div className={`schedule-operational-stop is-${stop.kind}${point ? ' is-point' : ''}${iconOnly ? ' is-icon-only' : ''}`}
    style={{ left:`${left * 100}%`, width:iconOnly ? '24px' : `max(${stopMinimumWidth(stop)}px, ${width * 100}%)`, top }}
    role="note" aria-label={detail} title={detail}
    data-operational-stop={stop.kind} data-operational-location={stop.name} data-operational-icon={icon || undefined}>
    {icon ? <><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {icon === 'house' ? <path d="M3 11 12 3l9 8M5 10v11h14V10M10 21v-7h4v7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        : icon === 'dump' ? <DumpTruckGlyph />
          : <path d="M4 3h16v4h-6v10h6v4H4v-4h6V7H4V3Z" fill="currentColor" />}
    </svg></> : <span>{stop.label}</span>}
  </div>;
}
