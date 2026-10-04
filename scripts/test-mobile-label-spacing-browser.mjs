import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,webkit} from 'playwright';
const output=process.env.SCHEDULE_SCREENSHOT_DIR || '/tmp/mobile-label-evidence';
fs.mkdirSync(output,{recursive:true});
const before=process.env.CAPTURE_BASELINE==='1';
const jobs=[0,1].map(i=>({recordId:`2026-09-07:appointment:${1001+i}`,appointmentId:String(1001+i),version:'a'.repeat(64),callAhead:'not_called',jkNumber:`JK${1001+i}`,appointmentUrl:'',appointmentTime:i?'1:00 PM–2:00 PM':'12:00 PM–1:00 PM',appointmentStartMinutes:720+i*60,appointmentEndMinutes:780+i*60,hasScheduledTime:true,customerName:`Synthetic stop ${i+1}`,customerEmail:'',phone:'',address:'',territory:i?'Jefferson Parish':'New Orleans',appointmentType:'Job',status:'Confirmed',truck:'Truck 1',driver:'',navigator:'',paymentType:'',paymentAmount:0,tipAmount:0,junkItems:[],appointmentNotes:[],cancellationReason:'',location:null}));
const fixture={appointments:jobs,operationalStops:[],truckLoads:['1/2 full','5/8 full','Empty','1/2 full',null,'Full + 1/24','Load unknown','Full + 7/24','Empty'].flatMap((label,i)=>label?[{truck:`Truck ${i+1}`,label,note:'Synthetic load detail'}]:[]),legs:[{truck:'Truck 1',fromAppointmentId:jobs[0].recordId,toAppointmentId:jobs[1].recordId,travelMinutes:31,miles:18,gapMinutes:0,source:'osm_road_estimate'}]};
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
 const browser=await engine.launch();
 try {for(const width of [320,402,430,768,1440]) {
  const page=await browser.newPage({viewport:{width,height:1000},hasTouch:width<=900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(f=>{window.scheduleFixture=f;},fixture);
  await page.goto('http://127.0.0.1:3166/tests/schedule-destinations.html?scenario=label-spacing');
  const row=page.locator('[data-schedule-truck="Truck 1"]');
  await row.locator('.route-connector-label').waitFor();await page.waitForTimeout(300);
  const metrics=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-schedule-truck]')).map(row=>({truck:row.dataset.scheduleTruck,height:row.getBoundingClientRect().height,labelWidth:row.querySelector('.schedule-truck-cell').getBoundingClientRect().width,labels:Array.from(row.querySelectorAll('.schedule-truck-cell strong,.schedule-truck-load')).map(n=>{const b=n.getBoundingClientRect(),p=n.parentElement.getBoundingClientRect();return {text:n.textContent,inside:b.y>=p.y&&b.bottom<=p.bottom,title:n.title,clipped:n.scrollWidth>n.clientWidth};})})));
  const route=await row.locator('.route-connector-label').boundingBox();
  console.log(name,width,JSON.stringify({truck1Height:metrics[0].height,truck7:metrics.find(r=>r.truck==='Truck 7'),travelHeight:route.height}));
  if(!before) {
   assert.ok(metrics.every(r=>r.labels.every(l=>l.inside)),'Truck metadata fits inside its row');
   if(width<=900){assert.ok(metrics.every(r=>r.labelWidth===88));assert.equal(route.height,18);assert.ok(metrics[0].height<150,'One travel label does not add a 48px appointment lane');assert.ok(metrics.every(r=>!r.labels[0].clipped),'Truck names fit the existing 88px column');assert.equal(metrics.find(r=>r.truck==='Truck 7').labels[1].title,'Load unknown · Synthetic load detail');}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No page-wide overflow');
   assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  }
  await page.locator('.schedule-board-scroll').evaluate(n=>n.scrollLeft=280);
  if(width===402||width===1440)await page.locator('.schedule-board-shell').screenshot({path:`${output}/${before?'before':'after'}-${name}-${width}.png`});
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
}
