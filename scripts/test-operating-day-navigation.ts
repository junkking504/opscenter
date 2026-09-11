import assert from 'node:assert/strict';
import { currentOperatingDay, isOperatingDay, normalizeOperatingDayUrl, operatingDayLabel, operatingDayUrl, shiftOperatingDay } from '../desktop-ui/lib/operating-day';
import { workspaceUrl } from '../desktop-ui/lib/workspace-navigation';

const legacy = 'https://ops.example/desktop?workspace=Schedule&date=2026-09-10&scheduleDay=tomorrow&scheduleView=board';
const selected = normalizeOperatingDayUrl(legacy, '2026-09-11');
assert.equal(selected.searchParams.get('date'), '2026-09-11');
assert.equal(selected.searchParams.get('scheduleDay'), 'today');
assert.equal(normalizeOperatingDayUrl(selected.href).href, selected.href, 'Reload must not advance the day twice');
for (const workspace of ['Command', 'Schedule', 'Krewe', 'Fleet', 'Marketing', 'Finance']) {
  const destination = workspaceUrl(selected.href, { workspace });
  assert.equal(normalizeOperatingDayUrl(destination.href).searchParams.get('date'), '2026-09-11', `${workspace} must retain September 11`);
}
assert.equal(normalizeOperatingDayUrl(legacy.replace('workspace=Schedule', 'workspace=Command')).searchParams.get('date'), '2026-09-10', 'An old Command link keeps the date it actually displayed');
const next = operatingDayUrl(selected.href + '&appointment=old-record&q=old-search', '2026-09-12');
assert.equal(next.searchParams.get('date'), '2026-09-12');
assert.equal(next.searchParams.get('scheduleDay'), 'today');
assert.equal(next.searchParams.has('appointment'), false);
assert.equal(next.searchParams.has('q'), false);
const calendar = operatingDayUrl(selected.href.replace('board', 'calendar'), '2026-10-01');
assert.equal(calendar.searchParams.get('scheduleView'), 'calendar', 'The shared date bar keeps the selected subview');
assert.equal(operatingDayUrl(calendar.href, '2026-10-02', 'Schedule').searchParams.get('scheduleView'), 'board', 'Opening a calendar day goes to its board');
assert.equal(shiftOperatingDay('2026-09-11', -1), '2026-09-10');
assert.equal(shiftOperatingDay('2026-12-31', 1), '2027-01-01');
assert.equal(shiftOperatingDay('2028-02-28', 1), '2028-02-29');
assert.equal(shiftOperatingDay('2026-03-08', 1), '2026-03-09', 'DST must not shift calendar dates');
assert.equal(currentOperatingDay(new Date('2026-09-12T04:59:59Z')), '2026-09-11');
assert.equal(currentOperatingDay(new Date('2026-09-12T05:00:00Z')), '2026-09-12');
assert.equal(operatingDayLabel('2026-09-11'), 'Friday, Sep 11, 2026');
for (const invalid of ['', '2026-02-30', '2026-13-01', '2026-9-11', 'invalid']) assert.equal(isOperatingDay(invalid), false);
assert.equal(isOperatingDay('2028-02-29'), true);
assert.equal(normalizeOperatingDayUrl('https://ops.example/desktop?date=invalid').searchParams.has('date'), false);
assert.equal(normalizeOperatingDayUrl('https://ops.example/desktop').searchParams.has('date'), false, 'Unpinned sessions must still follow Chicago midnight');
console.log('Operating-day navigation checks passed: legacy links, all workspaces, date changes, subviews, invalid dates, and Chicago midnight.');
