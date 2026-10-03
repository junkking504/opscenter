import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium,webkit} from 'playwright';
const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3164';
const output=process.env.SCHEDULE_SCREENSHOT_DIR || '/tmp/mobile-schedule-evidence';
fs.mkdirSync(output,{recursive:true});
let saved;
if(process.env.SCHEDULE_VISIT_FILE) {
  const source=JSON.parse(fs.readFileSync(process.env.SCHEDULE_VISIT_FILE,'utf8'));
  const visits=source.visits.filter(v=>v.truck_number==='Truck 3'&&v.match_confidence==='confirmed'&&!v.pass_by_only&&v.visit_intervals?.length);
  assert.equal(new Set(visits.map(v=>v.appointment_id)).size,visits.length,'Saved Truck 3 visits have unique appointment identities');
  const appointments=visits.map((v,i)=>({recordId:`2026-09-08:appointment:${1001+i}`,appointmentId:String(1001+i),jkNumber:`JK100${1001+i}`,version:'a'.repeat(64),callAhead:'not_called',truck:'Truck 3',status:'Completed',appointmentType:'Job',customerName:`Example appointment ${i+1}`,address:'',phone:'',customerEmail:'',appointmentUrl:'',territory:'Baton Rouge',hasScheduledTime:true,appointmentTime:'11:00 AM–12:00 PM',appointmentStartMinutes:660,appointmentEndMinutes:720,driver:'',navigator:'',paymentType:'',paymentAmount:0,tipAmount:0,junkItems:[],appointmentNotes:[],cancellationReason:'',location:null,truckVisits:v.visit_intervals.map(x=>({truck:'Truck 3',arrival:x.arrival.replace(source.date,'2026-09-08'),departure:x.departure?.replace(source.date,'2026-09-08'),observedThrough:(x.departure||source.collection_timestamp).replace(source.date,'2026-09-08')}))}));
  const ordered=[...appointments].sort((a,b)=>Date.parse(a.truckVisits[0].arrival)-Date.parse(b.truckVisits[0].arrival));
  const legs=ordered.slice(1).map((to,i)=>({truck:'Truck 3',fromAppointmentId:ordered[i].recordId,toAppointmentId:to.recordId,fromJk:ordered[i].jkNumber,toJk:to.jkNumber,travelMinutes:[11,8,8,26][i],miles:[5.2,3,3.2,13.8][i],gapMinutes:0,source:'osm_road_estimate'}));
  const operationalStops=[{id:'departure',truck:'Truck 3',name:'HQ',kind:'departure',label:'HQ departure',startMinutes:420,endMinutes:420,ongoing:false},{id:'dump',truck:'Truck 3',name:'Dump',kind:'dump',label:'Dump',startMinutes:977,endMinutes:987,ongoing:false}];
  saved={appointments,legs,operationalStops};
}
const boxesOverlap=(a,b)=>a.x<b.x+b.width-.5&&a.x+a.width>b.x+.5&&a.y<b.y+b.height-.5&&a.y+a.height>b.y+.5;
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
 const browser=await engine.launch({headless:true});
 try {
  for(const width of [320,390,430,768,1440]) {
   const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<=900});
   const errors=[];const api=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url());});
   if(saved)await page.addInitScript(payload=>{window.scheduleFixture=payload;},saved);
   await page.goto(`${base}/tests/schedule-destinations.html?scenario=${saved?'saved-truck3':'mobile-nearby'}`);
   const row=page.locator(`[data-schedule-truck="${saved?'Truck 3':'Truck 8'}"]`);
   const blocks=row.locator('[data-schedule-appointment]');await blocks.first().waitFor();
   await page.waitForFunction(()=>document.querySelector('[data-schedule-truck]')?.style.getPropertyValue('--schedule-row-height'));
   if(saved)await row.locator('.route-connector-label').first().waitFor();
   const metrics=await row.evaluate(r=>({label:r.querySelector('.schedule-truck-cell').getBoundingClientRect().width,timeline:r.querySelector('.live-truck-timeline').getBoundingClientRect().width,height:r.getBoundingClientRect().height,scale:r.style.getPropertyValue('--schedule-timeline-scale')}));
   assert.equal(await blocks.count(),saved?saved.appointments.length:4);
   const b=await blocks.evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};}));
   for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++)assert.equal(boxesOverlap(b[i],b[j]),false,`${name} ${width}: appointments intersect`);
   const scroller=page.locator('.schedule-board-scroll');
   const alignment=()=>page.evaluate(()=>{const tick=document.querySelector('.schedule-time-row > span:nth-child(2)').getBoundingClientRect();const line=document.querySelector('.live-truck-timeline').getBoundingClientRect();return Math.abs(tick.x-line.x);});
   assert.ok(await alignment()<1,'Ruler and timelines share their origin');
   if(width<=900) {
    assert.equal(metrics.label,88);assert.ok(metrics.timeline>=720);
    const minimumWidth=await row.evaluate(n=>n.querySelector('.live-truck-timeline').getBoundingClientRect().width/((document.querySelectorAll('.schedule-time-row > span').length-1)*4));
    assert.ok(b.every(x=>x.width>=minimumWidth-.5&&x.height>=43.5),'Mobile appointments retain fifteen-minute widths and 44px height');
    const pinned=await row.locator('.schedule-truck-cell').boundingBox();
    await scroller.evaluate(n=>{n.scrollLeft=250;});
    assert.ok(Math.abs((await row.locator('.schedule-truck-cell').boundingBox()).x-pinned.x)<1,'Truck labels stay pinned while scrolling');
    assert.ok(await alignment()<1,'Ruler stays aligned after scrolling');
    assert.ok(await scroller.evaluate(n=>n.scrollLeft)>0,'The board scrolls horizontally');
    assert.ok((await scroller.boundingBox()).width<=width,'Horizontal overflow stays within the board');
    if(saved){const labels=await row.locator('.route-connector-label').evaluateAll(ns=>ns.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));assert.ok(labels.every(x=>x.width>=43.5&&x.height>=43.5));assert.ok(metrics.height<242,'Saved-data row is shorter than the old 242px appointment/travel allocation');}
   } else {assert.equal(metrics.label,160);assert.ok(metrics.timeline>0);}
   await scroller.evaluate(n=>{n.scrollLeft=0;});
   if(saved) {
    const axis=await page.evaluate(()=>{const ticks=[...document.querySelectorAll('.schedule-time-row > span')].slice(1);const t=document.querySelector('[data-schedule-truck="Truck 3"] .live-truck-timeline').getBoundingClientRect();return {hourWidth:ticks[0].getBoundingClientRect().width,timelineWidth:t.width,count:ticks.length};});
    assert.ok(Math.abs(axis.hourWidth*axis.count-axis.timelineWidth)<1,'Hourly ruler spans the exact timeline width');
   }
   if(width<=900&&saved)await scroller.evaluate(n=>{n.scrollLeft=280;});
   await page.locator('.schedule-board-shell').screenshot({path:path.join(output,`${name}-${width}.png`)});
   if(saved){
    const label=row.locator('.route-connector-label').first();await label.scrollIntoViewIfNeeded();
    if(width<=900)await label.tap();else await label.click();
    const dialog=page.locator('.schedule-route-popover:popover-open');await dialog.waitFor();
    assert.match(await dialog.innerText(),/11m/,'Travel time stays available in the details popover');
    assert.doesNotMatch(await dialog.innerText(),/mi\b/,'Travel distance is omitted from details');
    await dialog.getByRole('button',{name:'Close travel details'}).click();
   }
   const target=blocks.last();await target.scrollIntoViewIfNeeded();
   if(width<=900)await target.tap();else await target.click();
   await page.locator('.schedule-appointment-summary').waitFor();
   if(width===1440){
    await page.setViewportSize({width:390,height:900});
    await page.waitForFunction(()=>document.querySelector('[data-schedule-appointment]')?.getBoundingClientRect().height===44);
    assert.equal(await row.locator('.schedule-truck-cell').evaluate(n=>n.getBoundingClientRect().width),88);
    await page.setViewportSize({width:1440,height:900});
    await page.waitForFunction(()=>document.querySelector('[data-schedule-appointment]')?.getBoundingClientRect().height<44);
   }
   assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
   assert.deepEqual(api,[],'All fixture APIs stay in memory');assert.deepEqual(errors,[]);
   console.log(JSON.stringify({engine:name,width,...metrics,appointments:b.length,writes:0}));await page.close();
  }
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  await page.goto(`${base}/tests/schedule-destinations.html?scenario=same-time`);
  const blocks=page.locator('[data-schedule-truck="Truck 8"] [data-schedule-appointment]');await blocks.first().waitFor();
  const ys=await blocks.evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().y));assert.equal(new Set(ys).size,4,'Four true overlaps stay in four separate lanes');
  await page.locator('.schedule-board-shell').screenshot({path:path.join(output,`${name}-true-overlap.png`)});
  assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');await page.close();
  if(name==='chromium'){
   const touch=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
   await touch.goto(`${base}/tests/schedule-destinations.html?scenario=mobile-nearby`);
   const card=touch.locator('[data-schedule-truck="Truck 8"] [data-schedule-appointment]').first();await card.waitFor();await card.scrollIntoViewIfNeeded();
   const rect=await card.boundingBox(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
   const session=await touch.context().newCDPSession(touch);
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(const delta of [15,30,45,60,75]){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-delta,y}]});await touch.waitForTimeout(16);}
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await touch.waitForFunction(()=>document.querySelector('.schedule-board-scroll').scrollLeft>10);
   assert.equal(await touch.locator('#fixture-writes').innerText(),'Writes: 0','Swiping across a card scrolls without submitting a move');
   console.log('Native Chromium touch swipe across an appointment PASS: scrolling with zero moves.');await touch.close();
  }
 } finally {await browser.close();}
}
console.log('Phone and desktop browser PASS: alignment, scrolling, touch targets, saved visits, true overlaps and zero writes.');
