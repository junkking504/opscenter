import { weeklyMeter } from './lib/krewe-presentation';
import './krewe-presentation.css';
export function KreweManagerLock() {
  return <section className="krewe-manager-lock" aria-label="Managers only"><h2>Managers Only</h2><p>This page is available to managers and administrators. Today shows Krewe hours and assignments.</p></section>;
}
export function WeeklyHoursMeter({ hours }: { hours: number | null }) {
  const meter = weeklyMeter(hours);
  return <div className="krewe-week-meter" data-tone={meter.tone}><span>This Week</span><strong>{meter.value === null ? '—' : `${meter.value.toLocaleString('en-US', { maximumFractionDigits: 2 })} / 40 hrs`}{meter.tone === 'overtime' && <small>Overtime</small>}</strong><div className="krewe-meter-track" role={meter.value === null ? undefined : 'meter'} aria-label="This Week Hours" aria-valuemin={0} aria-valuemax={Math.max(40, meter.value || 0)} aria-valuenow={meter.value ?? undefined} aria-valuetext={meter.value === null ? undefined : `${meter.value} hours out of 40`}><i style={{ width: `${meter.percent}%` }}/><b title="40 hours" aria-hidden="true"/></div>{meter.value === null && <small>Weekly hours unavailable</small>}</div>;
}
export function SavedResultHelp() { return <p className="krewe-save-help">Check Saved Result retrieves the last save receipt so you can confirm it before trying again.</p>; }
