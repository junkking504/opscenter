import type { DesktopCommandSnapshot } from './live-contract';
import type { DesktopKreweSnapshot } from './people-fleet-contract';
import { isCompletedTvJob } from './shop-tv-completion';

export type TvCard = { id: string; kind: 'review' | 'record' | 'birthday' | 'anniversary' | 'welcome' | 'contest' | 'win'; title: string; body: string; credit: string; detail: string; before?: string; after?: string };
export type TvSpotlights = { date: string; generatedAt: string; reviewsAt: string | null; historyAt: string | null; cards: TvCard[]; notices: string[] };

export function tvTruckStandings(snapshot: DesktopCommandSnapshot) {
  if (!snapshot.crewProgress?.scheduleCurrent) return [];
  const trucks = new Map<string, { truck: string; crew: Set<string>; jobs: number; revenue: number; priced: number }>();
  const seen = new Set<string>();
  for (const job of snapshot.crewProgress.jobs) {
    if (seen.has(job.id) || !isCompletedTvJob(job.status) || !/^Truck\s+\d+$/i.test(job.truck)) continue;
    seen.add(job.id);
    const row = trucks.get(job.truck) || { truck: job.truck, crew: new Set<string>(), jobs: 0, revenue: 0, priced: 0 };
    row.jobs++;
    for (const name of job.crew.split(' · ')) if (name.trim() && !/unavailable|unassigned|not recorded/i.test(name)) row.crew.add(name.trim());
    const total = job.completion.total?.trim();
    if (total && /^\$?[\d,]+(?:\.\d+)?$/.test(total)) { row.revenue += Number(total.replace(/[$,]/g, '')); row.priced++; }
    trucks.set(job.truck, row);
  }
  return [...trucks.values()].map(row => ({ truck: row.truck, crew: [...row.crew].join(' · '), jobs: row.jobs, revenue: row.priced === row.jobs ? row.revenue : null, average: row.priced === row.jobs ? row.revenue / row.jobs : null }))
    .sort((a, b) => b.jobs - a.jobs || (b.revenue ?? -1) - (a.revenue ?? -1) || a.truck.localeCompare(b.truck, undefined, { numeric: true }));
}

export function tvPersonalRecords(history: DesktopKreweSnapshot, date: string): TvCard[] {
  if (history.date !== date || history.missingDates.length) return [];
  return history.members.flatMap(member => {
    const today = member.days.find(day => day.date === date);
    const previous = member.days.filter(day => day.date < date);
    if (!today || today.revenue == null || !Number.isFinite(today.revenue) || today.revenue <= 0 || !previous.length || previous.some(day => day.revenue == null || !Number.isFinite(day.revenue))) return [];
    const best = Math.max(...previous.map(day => day.revenue!));
    if (today.revenue <= best) return [];
    return [{ id: `record-${member.id}`, kind: 'record' as const, title: 'New month-to-date best!', body: `${member.name} just set a new daily credited-revenue best this month.`, credit: member.name, detail: `$${Math.round(today.revenue).toLocaleString('en-US')} today · previous best $${Math.round(best).toLocaleString('en-US')} · ${history.start} through ${date} · day in progress` }];
  });
}
