import assert from 'node:assert/strict';
import {scheduleViewportLayout} from '../desktop-ui/lib/schedule-viewport-layout';
const natural=[36,36,36,64,36,110,36,36,128,114];
const labels=natural.map(()=>26);
const footers=natural.map(height=>height>36?23:0);
for(const available of [100,200,320,500,550,700,1000]){
 const layout=scheduleViewportLayout(natural,labels,available,footers);
 assert.equal(layout.fits,true,'The complete board fits even in a short viewport');
 assert.ok(layout.heights.reduce((a,b)=>a+b,0)<=available);
 assert.ok(layout.scale>0 && layout.scale<=1);
 layout.heights.forEach((height,i)=>{
  assert.ok(height>=labels[i]*layout.chromeScale,'Truck labels stay inside their rows');
  assert.ok(height>=(natural[i]-footers[i])*layout.scale+footers[i]*layout.chromeScale-0.001,'Footer stays clear of appointment lanes');
 });
 if(available>=natural.reduce((a,b)=>a+b,0)) {
  assert.equal(layout.scale,1,'Reclaimed space preserves natural appointment size');
  assert.equal(layout.chromeScale,1);
  assert.equal(layout.heights.reduce((a,b)=>a+b,0),available);
 }
}
assert.equal(scheduleViewportLayout(natural,labels,550,footers).chromeScale,1,'Normal viewports preserve labels and progress text');
assert.deepEqual(scheduleViewportLayout([24],[36],100).heights,[100]);
assert.deepEqual(scheduleViewportLayout([32,32,32],[24,24,24],101).heights,[34,34,33]);
assert.deepEqual(scheduleViewportLayout([],[],0).heights,[]);
console.log('Complete-board fitting, natural sizes when possible, label/footer clearance and short screens passed.');
