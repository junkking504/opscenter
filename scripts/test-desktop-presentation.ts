import assert from 'node:assert/strict';
import { percentDelta } from '../desktop-ui/delta-chip';
import { shiftOperatingDay } from '../desktop-ui/lib/operating-day';
assert.equal(percentDelta(null, 100), null);
assert.equal(percentDelta(100, null), null);
assert.equal(percentDelta(100, 0), null);
assert.equal(percentDelta(Infinity, 100), null);
assert.equal(percentDelta(100, 100), 0);
assert.equal(percentDelta(120, 100), 20);
assert.equal(percentDelta(-80, -100), 20);
assert.equal(percentDelta(0, 100), -100);
assert.equal(new Date(shiftOperatingDay('2026-10-16', -364)).getUTCDay(), new Date('2026-10-16').getUTCDay());
console.log('Desktop percentage and same-weekday comparisons passed.');
import { truckSummaries } from '../desktop-ui/truck-summary-strip';
import type { ScheduleSnapshot, ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';
import { job } from './fixtures/crew-progress';
const finished = { ...job(), status:'Completed', truck:'Truck 2', closeout:{total:500,tip:50,balance:0,payments:[]},truckVisits:[{truck:'Truck 3',arrival:'2026-09-07T14:00:00Z',departure:'2026-09-07T14:20:00Z',observedThrough:'2026-09-07T14:20:00Z'}] } as unknown as ScheduleAppointment;
const snapshot: ScheduleSnapshot = {date:'2026-09-07',observedAt:'2026-09-07T18:00:00Z',appointments:[finished],fleet:{isToday:false,trucks:[],lastUpdatedAt:null}};
const summary = truckSummaries(snapshot,Date.parse('2026-09-07T18:00:00Z'));
assert.equal(summary.active.length,1,'A job visiting two trucks has one revenue owner');
assert.equal(summary.active[0].revenue,450,'Revenue excludes tips');
assert.equal(summary.active[0].status,'Done');
assert.equal(truckSummaries({...snapshot,appointments:[{...finished,closeout:null}]},0).active[0].revenue,null,'Missing charge evidence is not zero');
assert.equal(truckSummaries({...snapshot,appointments:[{...finished,status:'Open'}]},0).active[0].status,'Planned');
console.log('Truck strip preserves unique revenue ownership, tips, missing evidence and historical status.');
import { revenuePaceRows, previousYearDay } from '../desktop-ui/lib/revenue-pace';
assert.equal(previousYearDay('2024-02-29'), null);
const pace = revenuePaceRows([{date:'2026-10-01',revenue:0},{date:'2026-10-03',revenue:50},{date:'2025-10-01',revenue:10}], '2026-10-01','2026-10-03');
assert.deepEqual(pace.map(row=>row.current),[0,null,null]);
assert.deepEqual(pace.map(row=>row.daily),[0,null,50]);
assert.deepEqual(pace.map(row=>row.prior),[10,null,null]);
assert.equal(revenuePaceRows([], '2025-01-01','2026-10-16').length,0);
console.log('Revenue pace preserves zeroes, missing days, leap dates and bounded ranges.');
import { isCompletedTvJob } from '../desktop-ui/lib/shop-tv-completion';
for (const status of ['Completed', 'Job Completed', 'Closed', 'Job Closed', 'Paid', 'Completed Duration: 60 min(s)', 'Completed Duration: 15 min(s)', ' completed duration: 10 min(s) ']) {
  assert.equal(isCompletedTvJob(status), true, status);
}
for (const status of ['Estimate completed', 'Estimate · Completed Duration: 60 min(s)', 'Confirmed', 'Open', 'Unpaid', 'Cancelled', 'Not completed', 'Completed pending review', '']) {
  assert.equal(isCompletedTvJob(status), false, status);
}
console.log('Shop TV recognizes completed duration statuses and excludes estimates, cancellations and unconfirmed completions.');

// Display renames must not migrate stored workspace keys or break dated bookmarks.
import { workspaceLabel } from '../desktop-ui/lib/workspace-labels';
import { workspacePages, pageHref } from '../desktop-ui/page-rail';
const finalNames = { Command: 'Dashboard', Schedule: 'Command', Krewe: 'Krewe', Fleet: 'Fleet', Finance: 'Finance', Marketing: 'Marketing' };
for (const [key, label] of Object.entries(finalNames)) {
  assert.equal(workspaceLabel(key), label);
  const group = workspacePages.find(group => group.workspace === key)!;
  assert.equal(group.label, label);
  const destination = new URL(pageHref(key, group.key, group.pages[0][0], 'https://example.test/desktop?date=2026-10-21&appointment=old'), 'https://example.test');
  assert.equal(destination.searchParams.get('workspace'), key);
  assert.equal(destination.searchParams.get('date'), '2026-10-21');
  assert.equal(destination.searchParams.has('appointment'), false);
}
console.log('Final workspace names preserve dated links and internal keys.');
