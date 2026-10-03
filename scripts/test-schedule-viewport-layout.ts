import assert from 'node:assert/strict';
import {scheduleViewportLayout} from '../desktop-ui/lib/schedule-viewport-layout';
const natural=[36,36,36,64,36,110,36,36,128,114];
const labels=natural.map(()=>36);
for(const available of [200,320,500,550,700,1000]){
 const layout=scheduleViewportLayout(natural,labels,available);
 assert.equal(layout.scale,1,'Routing or viewport changes must never squeeze blocks thinner');
 assert.deepEqual(layout.heights,natural);
 assert.equal(layout.fits,natural.reduce((a,b)=>a+b,0)<=available);
}
assert.deepEqual(scheduleViewportLayout([24],[36],100).heights,[36]);
assert.deepEqual(scheduleViewportLayout([],[],0).heights,[]);
console.log('Stable schedule block thickness passed across short and tall viewports.');
