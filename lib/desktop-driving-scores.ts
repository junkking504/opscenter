import { buildFleetDailyRecord } from './fleet-history';
import { DRIVING_SCORE_ALERT_RULES } from './driving-score-policy';
import type { DrivingScore } from '../desktop-ui/lib/driving-score';
type Row = Record<string, unknown>;
const number = (value: unknown): number | null => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const nameKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const truckKey = (value: string) => value.match(/\d+/)?.[0] || value;
export function presentDrivingScores(date: string, rows: Row[]): DrivingScore[] {
  return rows.map(row => {
    const drivers = [...new Set<string>((Array.isArray(row.assigned_drivers) ? row.assigned_drivers : []).map(String).map(value => value.trim()).filter(Boolean))];
    const score = number(row.opscenter_driving_score);
    const counts = (row.weighted_alert_counts || {}) as Record<string, unknown>;
    const availability = (row.weighted_alert_availability || {}) as Record<string, unknown>;
    const deductions = (row.alert_deductions || {}) as Record<string, unknown>;
    const status = String(row.driver_score_status || row.confidence_status || 'Unverified');
    return {date, truck: String(row.truck || 'Unknown truck'), drivers, score,
      display: score === null ? String(row.driver_score_display || 'Insufficient driving data') : score.toFixed(1),
      status, source: String(row.driver_score_source || 'OpsCenter calculated'),
      warning: [row.driver_score_warning, ...(Array.isArray(row.data_quality_notes) ? row.data_quality_notes : [])].filter(Boolean).join(' · '),
      attribution: drivers.length === 1 && status.toLowerCase() === 'confirmed' && String(row.confidence_status || '').toLowerCase() === 'confirmed' ? 'confirmed' : 'review',
      miles: number(row.miles_driven), driveMinutes: number(row.drive_minutes), idleMinutes: number(row.idle_minutes),
      safetyScore: number(row.safety_score), idleScore: number(row.idle_score),
      afterHoursPenalty: number(row.after_hours_events) === null ? null : Math.min(10, Math.max(0, Number(row.after_hours_events)) * 2),
      events: DRIVING_SCORE_ALERT_RULES.map(rule => ({label: rule.label,
        count: availability[rule.key] ? number(counts[rule.key]) : null,
        deduction: availability[rule.key] ? number(deductions[rule.key]) : null}))};
  });
}
export function readDesktopDrivingScores(date: string): DrivingScore[] {
  return presentDrivingScores(date, buildFleetDailyRecord(date)?.truckScoreRows || []);
}
export function memberDrivingScores(rows: DrivingScore[], name: string, truck: string): DrivingScore[] {
  return rows.filter(row => row.drivers.some(driver => nameKey(driver) === nameKey(name)) || truckKey(row.truck) === truckKey(truck))
    .map(row => ({...row, attribution: row.drivers.some(driver => nameKey(driver) === nameKey(name)) ? row.attribution : 'truck'}));
}
