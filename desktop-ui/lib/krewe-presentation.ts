import type { KreweHoursSnapshot } from './krewe-hours-contract';
import type { DesktopKreweSnapshot } from './people-fleet-contract';
import { crewRph } from './crew-rph';
import { sumObserved } from './people-fleet-contract';

export const krewePages = [['today', 'Today'], ['callin', 'Call-In Plan'], ['leaderboard', 'Leaderboard'], ['payperiod', 'Pay Period'], ['monthly', 'Monthly']] as const;
export type KrewePage = typeof krewePages[number][0];
export const managerKrewePage = (view: string) => ['payperiod', 'monthly', 'leaderboard'].includes(view);
export const krewePurpose: Record<KrewePage, string> = {
  today: 'See who is working, their hours, and today’s production.',
  callin: 'Plan tomorrow’s coverage and record availability.',
  leaderboard: 'Compare production and driving across the Krewe.',
  payperiod: 'Review hours, resolve flags, and prepare payroll reports.',
  monthly: 'Review monthly labor, production, and payroll.',
};
export function weeklyHours(hours: KreweHoursSnapshot | undefined, id: string, date: string): number | null {
  if (!hours || hours.date !== date) return null;
  const week = hours.employees.find(employee => employee.id === id)?.weeks.find(week => week.start <= date && week.end >= date);
  if (!week || week.incomplete || hours.missingDates.some(day => day >= week.start && day <= date)) return null;
  return week.total !== null && Number.isFinite(week.total) ? week.total : null;
}
export function weeklyMeter(hours: number | null) {
  const value = hours !== null && Number.isFinite(hours) && hours >= 0 ? hours : null;
  return { value, percent: value === null ? 0 : Math.min(value / 40 * 100, 100), tone: value === null ? 'missing' : value > 40 ? 'overtime' : value >= 36 ? 'warning' : 'normal' };
}
export type LeaderboardPeriod = 'today' | 'week' | 'month';
export type LeaderboardMeasure = 'rph' | 'jobs' | 'driving';
export function leaderboardRange(date: string, period: LeaderboardPeriod) {
  const day = new Date(`${date}T12:00:00Z`);
  if (period === 'week') day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return { start: period === 'month' ? `${date.slice(0, 7)}-01` : period === 'week' ? day.toISOString().slice(0, 10) : date, end: date };
}
export function rankKrewe(snapshot: DesktopKreweSnapshot | null, date: string, period: LeaderboardPeriod, measure: LeaderboardMeasure) {
  const { start, end } = leaderboardRange(date, period);
  if (!snapshot || snapshot.date !== date || snapshot.start > start || snapshot.end < end || snapshot.missingDates.some(day => day >= start && day <= end)) return [];
  const rows = snapshot.members.flatMap(member => {
    const days = member.days.filter(day => day.date >= start && day.date <= end);
    const hours = sumObserved(days.map(day => day.hours));
    if (hours === null || hours < 8 || !Number.isFinite(hours)) return [];
    const driving = (member.drivingScores || []).filter(row => row.date >= start && row.date <= end);
    const score = driving.length && driving.every(row => row.attribution === 'confirmed' && row.score !== null && Number.isFinite(row.score))
      ? driving.reduce((sum, row) => sum + row.score!, 0) / driving.length : null;
    // Credited revenue/jobs are already shared by the source for two-person Krewes.
    const value = measure === 'rph' ? crewRph({ members: days, missingDates: [] }).value : measure === 'jobs' ? sumObserved(days.map(day => day.jobs)) : score;
    return value !== null && Number.isFinite(value) ? [{ id: member.id, name: member.name, hours, value }] : [];
  }).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  let rank = 0;
  return rows.map((row, index) => {
    if (!index || rows[index - 1].value !== row.value) rank = index + 1;
    return { ...row, rank };
  });
}
