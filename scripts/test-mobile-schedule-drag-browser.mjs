import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,webkit} from 'playwright';
const dir=process.env.SCHEDULE_SCREENSHOT_DIR||'/tmp/mobile-drag-evidence';fs.mkdirSync(dir,{recursive:true});
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch();try{
 for(const [width,height] of [[320,650],[393,650],[650,393]]){
  const page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true,recordVideo:name==='chromium'&&width===393?{dir,size:{width,height}}:undefined});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const load=async(scenario='truck-scroll')=>{await page.goto(`http://127.0.0.1:3166/tests/schedule-destinations.html?scenario=${scenario}`);await page.locator('.mobile-schedule-visit').first().waitFor();await page.locator('.schedule-board-shell').evaluate(n=>window.scrollTo(0,scrollY+n.getBoundingClientRect().top-4));await page.evaluate(()=>{window.fixtureCaptured=[];const original=window.fetch;window.fetch=(input,init)=>{if(init?.method==='POST')window.fixtureCaptured.push(JSON.parse(init.body));return original(input,init);};});};
  let sourceTruck='Truck 3',sourceIndex=0;
  const card=()=>page.locator(`[data-overview-truck="${sourceTruck}"] .mobile-schedule-visit`).nth(sourceIndex);
  const moveButton=()=>page.locator('.mobile-schedule-guide button');
  const review=()=>page.getByRole('dialog',{name:'Review appointment move'});
  const drag=async({dx=0,truck='Truck 8',cancel=false,invalid=false}={})=>{
   const b=await card().boundingBox(),target=await page.locator(`[data-overview-truck="${truck}"] .mobile-schedule-track`).boundingBox();
   const x=b.x+b.width/2,y=b.y+b.height/2,ex=invalid?30:x+dx,ey=target.y+target.height/2;
   if(name==='chromium'){
    const session=await page.context().newCDPSession(page);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=8;i++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(ex-x)*i/8,y:y+(ey-y)*i/8}]});await page.waitForTimeout(20);}
    if(cancel==='resize'){await page.setViewportSize({width:width+1,height});await page.waitForTimeout(50);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.setViewportSize({width,height});}else if(cancel==='escape'){await page.keyboard.press('Escape');await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else if(cancel)await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});else await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
   }else{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(ex,ey,{steps:8});if(cancel==='resize'){await page.setViewportSize({width:width+1,height});await page.waitForTimeout(50);}else if(cancel)await page.keyboard.press('Escape');await page.mouse.up();if(cancel==='resize')await page.setViewportSize({width,height});}
   await page.waitForTimeout(100);
  };
  await load();assert.ok((await page.locator('.schedule-board-shell').boundingBox()).height<=height);
  // Native tap remains details and never writes.
  await card().tap();await page.locator('.job-record-drawer').waitFor();assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');await page.locator('.job-record-drawer').getByRole('button',{name:'Close',exact:true}).first().click();await page.locator('.job-record-drawer').waitFor({state:'detached'});
  await moveButton().tap();await page.waitForFunction(()=>document.querySelector('.mobile-schedule-guide button')?.getAttribute('aria-pressed')==='true');
  if(name==='chromium'){
   const session=await page.context().newCDPSession(page),blank=await page.locator('[data-overview-truck="Truck 8"] .mobile-schedule-track').boundingBox(),prior=await page.evaluate(()=>scrollY),x=blank.x+blank.width-8,y=blank.y+blank.height/2;
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=6;i++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*12}]});await page.waitForTimeout(20);}await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);assert.ok(await page.evaluate(()=>scrollY)>prior+20,'Blank space still scrolls in move mode');assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');await page.locator('.schedule-board-shell').evaluate(n=>window.scrollTo(0,scrollY+n.getBoundingClientRect().top-4));await session.detach();
  }
  await drag({cancel:true});assert.equal(await review().count(),0);assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  await drag({cancel:'escape'});assert.equal(await review().count(),0);await drag({cancel:'resize'});assert.equal(await review().count(),0);await drag({invalid:true});assert.equal(await review().count(),0);assert.equal(await page.locator('body.schedule-pointer-drag').count(),0);
  await drag();await review().waitFor({timeout:3000}).catch(async e=>{await page.screenshot({path:`${dir}/failure-${name}-${width}.png`});console.log('diagnostic',await page.locator('.mobile-schedule-guide').innerText(),await page.locator('.job-record-drawer').count(),await card().boundingBox());throw e;});assert.match(await review().innerText(),/To Truck# 8/);assert.match(await review().innerText(),/9:00 AM–10:00 AM/);assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');await review().getByRole('button',{name:'Cancel',exact:true}).tap();
  // Repeated gestures do not retain a stale proposal; retime one hour relative to source.
  const track=await page.locator('[data-overview-truck="Truck 3"] .mobile-schedule-track').boundingBox();const range=await page.locator('.mobile-schedule-overview').evaluate(n=>Number(n.dataset.rangeEnd)-Number(n.dataset.rangeStart));
  await drag({dx:track.width*60/range});await review().waitFor();assert.match(await review().innerText(),/10:00 AM–11:00 AM/);await page.screenshot({path:`${dir}/review-${name}-${width}x${height}.png`});
  await review().getByRole('button',{name:'Confirm Move'}).tap();await page.waitForFunction(()=>window.fixtureCaptured.length===1);const sent=await page.evaluate(()=>window.fixtureCaptured[0]);assert.equal(sent.values.truck,'Truck 8');assert.equal(sent.recordId,'2026-09-08:appointment:1001');assert.equal(sent.action,'move');assert.equal(sent.values.appointmentStartMinutes,600);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.fixtureCaptured.length),1);
  assert.deepEqual(errors,[]);
  await load('same-time');sourceTruck='Truck 8';sourceIndex=3;await moveButton().tap();assert.equal(await page.locator('.mobile-schedule-visit').count(),4);await drag({truck:'Truck 3'});await review().waitFor();assert.match(await review().innerText(),/JK1001004/);await review().getByRole('button',{name:'Cancel',exact:true}).tap();assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  await load('mobile-move-small');sourceTruck='Truck 3';sourceIndex=0;await moveButton().tap();assert.ok((await card().boundingBox()).width<20,'Small recorded marker at the 15-minute display minimum');await drag({truck:'Truck 8'});await review().waitFor();await review().getByRole('button',{name:'Cancel',exact:true}).tap();
  await load('mobile-move-half-hour');sourceTruck='Truck 3';sourceIndex=0;await moveButton().tap();await drag({dx:60});await review().waitFor();assert.equal(await review().getByRole('button',{name:'Confirm Move'}).isDisabled(),true);await review().getByRole('button',{name:'Cancel',exact:true}).tap();await drag();await review().waitFor();assert.equal(await review().getByRole('button',{name:'Confirm Move'}).isDisabled(),false);assert.match(await review().innerText(),/9:30 AM/);await review().getByRole('button',{name:'Cancel',exact:true}).tap();
  await load('mobile-move-pending');sourceTruck='Truck 3';await moveButton().tap();await drag();assert.equal(await review().count(),0);assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  await load('canceled');sourceTruck='Unassigned';sourceIndex=0;await moveButton().tap();await drag();assert.equal(await review().count(),0);assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  await load();sourceTruck='Truck 3';await moveButton().tap();await drag({truck:'Truck 4'});await review().waitFor();assert.match(await review().innerText(),/Overlapping appointments:/);await review().getByRole('button',{name:'Cancel',exact:true}).tap();await moveButton().tap();await card().tap();await page.locator('.job-record-drawer').waitFor();assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');assert.deepEqual(errors,[]);
  await page.close();console.log(name,width,height,'cancel, invalid, repeated drag, review, exact truck/time and single synthetic submission pass');
 }
 }finally{await browser.close();}
}
console.log('Mobile deliberate move mode passed. Chromium uses native touch; WebKit uses pointer drag plus native taps. No live API calls.');
