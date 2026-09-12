import assert from 'node:assert/strict';
import {scheduleViewportLayout} from '../desktop-ui/lib/schedule-viewport-layout';
const natural=[36,36,36,64,36,110,36,36,128,114];
const labels=natural.map(()=>36);
for(const available of [500,550,700,1000]){
 const layout=scheduleViewportLayout(natural,labels,available);
 assert.ok(layout.fits);
 assert.ok(layout.heights.reduce((a,b)=>a+b,0)<=available);
 assert.ok(layout.heights.every((height,i)=>height>=labels[i] && height>=natural[i]*layout.scale));
}
const short=scheduleViewportLayout(natural,labels,200);
assert.equal(short.fits,false);
assert.equal(short.scale,.65);
assert.ok(short.heights.every(height=>height>=36),'Short windows retain readable labels and page scrolling');
assert.equal(scheduleViewportLayout(natural,labels,1000).scale,1);
assert.deepEqual(scheduleViewportLayout([],[],0).heights,[]);
console.log('Schedule viewport allocation passed: label floors, dense lanes, short screens and empty boards.');
