import assert from 'node:assert/strict';
import { territoryDemandQuestion, territoryWeekdaySummary, territoryDailyAverages, territoryReportingPeriod, territoryReportingIntent } from '../lib/local-territory-demand-answer';
assert(territoryDemandQuestion("what's our busiest day of the week per territory"));
assert(!territoryDemandQuestion('Why do Waypoint closeouts fail?'));
type Row = { date: string; metrics: { provisional: boolean; jobs_by_market: Record<string, number> } };
const rows = [1, 8, 15].flatMap((day): Row[] => [
  { date: `2026-09-${String(day).padStart(2, '0')}`, metrics: { provisional: false, jobs_by_market: { 'Junk King New Orleans': 3, 'New Orleans': 1, 'Northshore': 2 } } },
  { date: `2026-09-${String(day + 1).padStart(2, '0')}`, metrics: { provisional: false, jobs_by_market: { 'New Orleans': 4, 'Northshore': 1 } } },
]);
rows.push({ date: '2026-09-03', metrics: { provisional: true, jobs_by_market: { 'New Orleans': 999 } } });
rows.push({ date: '2026-09-22', metrics: { provisional: false, jobs_by_market: { 'New Orleans': 0 } } });
const summary = territoryWeekdaySummary(rows);
const no = summary.find(row => row.territory === 'New Orleans')!;
assert.deepEqual(no.winners.map(row => row.day), [2, 3]);
assert.equal(no.winners[0].average, 4);
assert.equal(no.winners[0].samples, 3);
assert.equal(summary.find(row => row.territory === 'Northshore')!.winners[0].day, 2);
assert.equal(territoryWeekdaySummary(rows.slice(0, 2))[0].winners.length, 0);
console.log('Territory demand: aliases, daily aggregation, ties, sample threshold, provisional exclusion and zero exclusion passed.');

assert(territoryDemandQuestion('give me average jobs per day in each territory for the last 365 days'));
assert.equal(territoryReportingIntent('total revenue by territory last month')?.metric, 'revenue');
assert.equal(territoryReportingIntent('how many jobs in Baton Rouge last month')?.operation, 'total');
assert.equal(territoryReportingIntent('compare territory revenue this month and last month'), null);
assert.deepEqual(territoryReportingPeriod('last 365 days', '2026-10-02', '2026-10-01'), {start:'2025-10-01',end:'2026-09-30',days:365});
assert.deepEqual(territoryReportingPeriod('September 2026', '2026-10-02', '2026-10-01'), {start:'2026-09-01',end:'2026-09-30',days:30});
assert.deepEqual(territoryReportingPeriod('from 2026-09-01 through 2026-09-05', '2026-10-02', '2026-10-01'), {start:'2026-09-01',end:'2026-09-05',days:5});
assert.equal(territoryReportingPeriod('last quarter', '2026-10-02', '2026-10-01'), null);
const averages = territoryDailyAverages(rows);
const avg = averages.find(row => row.territory === 'New Orleans')!;
assert.equal(avg.jobs, 24); assert.equal(avg.recordedDays, 7); assert.equal(avg.operatingDays, 6);
assert.equal(avg.calendarAverage, 24/7); assert.equal(avg.operatingAverage, 4);
assert.equal(averages.find(row => row.territory === 'Northshore')!.recordedDays, 6, 'absent territory is not zero');
console.log('Territory reporting: varied intents, rolling/named/explicit periods, totals, zero-inclusive averages and missing-territory coverage passed.');
