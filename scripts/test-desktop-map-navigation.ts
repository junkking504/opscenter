import assert from 'node:assert/strict';
import { nearbyMapPins, separateMapPins, groupMapPins } from '../desktop-ui/lib/schedule-map-layout';
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
assert.ok(layout.every(p=>p.dx===0 && p.dy===0),'Crowded regional groups must never fan across the map');
const pair=separateMapPins([{id:'appointment:1',x:1,y:1},{id:'truck:6',x:1,y:1}]);
assert.equal(pair[0].dx,0);assert.equal(pair[1].dx,44);
assert.deepEqual(separateMapPins([{id:'alone',x:123,y:456}]),[{id:'alone',x:123,y:456,dx:0,dy:0}]);
console.log('Crowded locators stay anchored; only a close truck/appointment pair receives a bounded offset.');

for (const points of [crowded, [...crowded,...crowded.map(p=>({...p,id:p.id+'far',x:p.x+105}))], [{id:'appointment:1',x:0,y:0},{id:'truck:3',x:0,y:0}], Array.from({length:40},(_,i)=>({id:String(i),x:(i%8)*45,y:Math.floor(i/8)*40}))]) {
  const original=JSON.stringify(points), groups=groupMapPins(points);
  assert.equal(JSON.stringify(points),original);
  assert.deepEqual(groupMapPins([...points].reverse()),groups);
  assert.equal(groups.flatMap(g=>g.members).length,points.length,'No locator is dropped');
  for(let i=0;i<groups.length;i++) for(let j=i+1;j<groups.length;j++) {
    const a=groups[i],b=groups[j];assert(Math.abs(a.x-b.x)>=(a.width+b.width)/2+4 || Math.abs(a.y-b.y)>=(a.height+b.height)/2+4,'Rendered footprints must never overlap');
  }
}
console.log('Non-overlapping group footprints passed for pairs, dense yards, adjoining clusters and refresh order.');
