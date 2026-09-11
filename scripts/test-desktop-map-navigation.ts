import assert from 'node:assert/strict';
import { separateMapPins } from '../desktop-ui/lib/schedule-map-layout';
import { navigationValue, workspaceUrl } from '../desktop-ui/lib/workspace-navigation';
const url = workspaceUrl('https://ops.junk-king.app/desktop?data=live&date=2026-09-04&workspace=Command', { workspace: 'Schedule', scheduleView: 'calendar', scheduleDay: 'tomorrow' });
assert.equal(url.searchParams.get('date'), '2026-09-04');
assert.equal(url.searchParams.get('data'), 'live');
assert.equal(navigationValue(url.search, 'workspace', ['Command','Schedule'], 'Command'), 'Schedule');
assert.equal(navigationValue(url.search, 'scheduleView', ['board','calendar'], 'board'), 'calendar');
assert.equal(navigationValue('?scheduleView=invalid', 'scheduleView', ['board','calendar'], 'board'), 'board');

const crowded = Array.from({length:24},(_,i)=>({id:`${i<16?'appointment':'truck'}:${i}`,x:300+i%3,y:210+i%2}));
for (const points of [crowded, [{id:'appointment:1',x:1,y:1},{id:'truck:3',x:1,y:1}], Array.from({length:40},(_,i)=>({id:String(i),x:(i%8)*45,y:Math.floor(i/8)*40}))]) {
  const source=JSON.stringify(points), layout=separateMapPins(points);
  assert.equal(JSON.stringify(points),source,'Geographic anchor projections are never mutated');
  assert.deepEqual(separateMapPins([...points].reverse()),layout,'Refresh order must not shuffle locators');
  assert.deepEqual(layout.map(p=>p.id).sort(),points.map(p=>p.id).sort(),'Every appointment and truck retains its own locator');
  for(let i=0;i<layout.length;i++) for(let j=i+1;j<layout.length;j++) {
    const a=layout[i],b=layout[j];
    assert(Math.abs(a.x+a.dx-b.x-b.dx)>=48 || Math.abs(a.y+a.dy-b.y-b.dy)>=44,'Individual icon footprints must not overlap');
  }
}
const yard=separateMapPins(crowded,{left:0,top:0,right:600,bottom:420});
assert(yard.every(p=>Math.hypot(p.dx,p.dy)<160),'Dense yard offsets stay compact');
for(const corner of [{x:1,y:1},{x:599,y:419}]) {
 const edge=separateMapPins(crowded.slice(0,8).map(p=>({...p,...corner})),{left:0,top:0,right:600,bottom:420});
 assert(edge.every(p=>p.x+p.dx>=24 && p.x+p.dx<=576 && p.y+p.dy>=22 && p.y+p.dy<=398),'Visible locators must stay within the map');
}
assert.deepEqual(separateMapPins([{id:'alone',x:123,y:456}]),[{id:'alone',x:123,y:456,dx:0,dy:0}]);
console.log('Individual map locators: full counts, no collisions, compact offsets, viewport edges, stable refresh and navigation passed.');
