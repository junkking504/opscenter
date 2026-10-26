import assert from 'node:assert/strict';
import {scheduleViewportLayout} from '../desktop-ui/lib/schedule-viewport-layout';
const natural=[36,36,36,64,36,110,36,36,128,114];
const labels=natural.map(()=>26);
const footers=natural.map(height=>height>36?23:0);
for(const available of [200,320,500,550,700,1000]){
 const layout=scheduleViewportLayout(natural,labels,available,footers);
 assert.equal(layout.scale,1,'Never shrink appointment lanes');
 assert.equal(layout.fits,layout.heights.reduce((a,b)=>a+b,0)<=available);
 layout.heights.forEach((height,i)=>{
  assert.ok(height>=labels[i],'Truck labels retain their full height');
  assert.ok(height>=(natural[i]-footers[i])*layout.scale+footers[i],'Status footer does not overlap scaled lanes');
 });
 if(available>=natural.reduce((a,b)=>a+b,0)) {
  assert.equal(layout.scale,1);
  assert.equal(layout.heights.reduce((a,b)=>a+b,0),available,'Sparse schedules fill the shared panel height');
 }
}
const fitted=scheduleViewportLayout(natural,labels,550,footers);
assert.equal(fitted.scale,1,'Crowded boards preserve natural lane height');
assert.deepEqual(fitted.heights,natural,'Crowded boards scroll instead of shrinking');
assert.equal(scheduleViewportLayout(natural,labels,200,footers).fits,false,'Extremely short windows fall back to scrolling');
assert.deepEqual(scheduleViewportLayout([24],[36],100).heights,[100]);
assert.deepEqual(scheduleViewportLayout([32,32,32],[24,24,24],101).heights,[34,34,33],'Spare pixels are shared evenly without overflow');
assert.deepEqual(scheduleViewportLayout([],[],0).heights,[]);
console.log('Natural schedule rows, label/footer clearance and reachable overflow passed.');

const compact=scheduleViewportLayout(natural,labels,400,footers);
assert.equal(compact.scale,1,'Busy boards never compress appointment text');
assert.equal(compact.fits,false,'Busy boards retain reachable scrolling');
compact.heights.forEach((height,i)=>assert.ok(height>=labels[i] && height>=footers[i],'Labels and status footers remain readable'));
assert.equal(scheduleViewportLayout(natural,labels,1000,footers).heights.reduce((a,b)=>a+b,0),1000,'Sparse boards still fill the panel');
