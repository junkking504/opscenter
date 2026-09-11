import assert from 'node:assert/strict';
import { navigationValue, workspaceUrl } from '../desktop-ui/lib/workspace-navigation';
const url = workspaceUrl('https://ops.junk-king.app/desktop?data=live&date=2026-09-04&workspace=Command', { workspace: 'Schedule', scheduleView: 'calendar', scheduleDay: 'tomorrow' });
assert.equal(url.searchParams.get('date'), '2026-09-04');
assert.equal(url.searchParams.get('data'), 'live');
assert.equal(navigationValue(url.search, 'workspace', ['Command','Schedule'], 'Command'), 'Schedule');
assert.equal(navigationValue(url.search, 'scheduleView', ['board','calendar'], 'board'), 'calendar');
assert.equal(navigationValue('?scheduleView=invalid', 'scheduleView', ['board','calendar'], 'board'), 'board');

console.log('Map workspace navigation passed.');
