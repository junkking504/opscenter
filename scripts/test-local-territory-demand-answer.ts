import assert from 'node:assert/strict';
import { territoryDemandQuestion, territoryWeekdaySummary } from '../lib/local-territory-demand-answer';
assert(territoryDemandQuestion("what's our busiest day of the week per territory"));
assert(!territoryDemandQuestion('Why do Waypoint closeouts fail?'));
const rows: Array<{ date: string; metrics: { provisional: boolean; jobs_by_market: Record<string, number> } }> = [1, 8, 15].flatMap(day => [
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
