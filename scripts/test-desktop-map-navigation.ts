import assert from 'node:assert/strict';
import { nearbyMapPins, separateMapPins } from '../desktop-ui/lib/schedule-map-layout';
import { navigationValue, workspaceUrl } from '../desktop-ui/lib/workspace-navigation';
const crowded = Array.from({ length: 14 }, (_, i) => ({ id: `${i < 10 ? 'appointment' : 'truck'}:${i}`, x: 200 + i % 3, y: 200 + i % 2 }));
const source = JSON.stringify(crowded);
const nearby = nearbyMapPins(crowded, 'appointment:0');
assert.equal(JSON.stringify(crowded), source, 'Overlap discovery must never mutate source positions');
assert.deepEqual(nearby, [...crowded].sort((a,b)=>a.id.localeCompare(b.id)), 'Every overlapping appointment and truck remains selectable at its original point');
assert.deepEqual(nearbyMapPins([...crowded].reverse(), 'appointment:0'), nearby, 'Refresh ordering must not shuffle the chooser');
const separated = [{id:'a',x:0,y:0},{id:'b',x:30,y:0},{id:'c',x:60,y:0}];
assert.deepEqual(nearbyMapPins(separated,'a'),separated.slice(0,2), 'Do not pull in distant pins through chains of neighbors');
assert.deepEqual(nearbyMapPins(separated,'a',15),[separated[0]], 'Zooming apart removes unrelated choices');
assert.deepEqual(nearbyMapPins(separated,'missing'),[]);
const url = workspaceUrl('https://ops.junk-king.app/desktop?data=live&date=2026-09-04&workspace=Command', { workspace: 'Schedule', scheduleView: 'calendar', scheduleDay: 'tomorrow' });
assert.equal(url.searchParams.get('date'), '2026-09-04');
assert.equal(url.searchParams.get('data'), 'live');
assert.equal(navigationValue(url.search, 'workspace', ['Command','Schedule'], 'Command'), 'Schedule');
assert.equal(navigationValue(url.search, 'scheduleView', ['board','calendar'], 'board'), 'calendar');
assert.equal(navigationValue('?scheduleView=invalid', 'scheduleView', ['board','calendar'], 'board'), 'board');
console.log('Exact map location, overlap chooser and refresh-navigation contracts passed.');

const layout = separateMapPins(crowded);
assert.equal(JSON.stringify(crowded), source);
assert.deepEqual(separateMapPins([...crowded].reverse()), layout);
for (const a of layout) {
  const original = crowded.find(p => p.id === a.id)!;
  assert.equal(a.x, original.x); assert.equal(a.y, original.y);
  for (const b of layout) if (a.id !== b.id) assert.ok(Math.hypot(a.x + a.dx - b.x - b.dx, a.y + a.dy - b.y - b.dy) >= 44 - 1e-8, 'Every icon and selected border remains separate');
}
assert.deepEqual(separateMapPins([{id:'alone',x:123,y:456}]),[{id:'alone',x:123,y:456,dx:0,dy:0}]);
assert.equal(separateMapPins([{id:'appointment:1',x:1,y:1},{id:'truck:6',x:1,y:1}]).length,2);
console.log('Crowded locators retain exact anchors, separate hit targets and stable offsets.');
