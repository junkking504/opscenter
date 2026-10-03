import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium,webkit} from 'playwright';
const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3166';
const output=process.env.SCHEDULE_SCREENSHOT_DIR || '/tmp/mobile-scroll-evidence';
fs.mkdirSync(output,{recursive:true});
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
 const browser=await engine.launch();
 try {
  for(const width of [320,402,768,1440]) {
   const mobile=width<=900;
   const page=await browser.newPage({viewport:{width,height:874},hasTouch:mobile,isMobile:mobile && name==='chromium'});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${base}/tests/schedule-destinations.html?scenario=same-time`);
   const row=page.locator('[data-schedule-truck="Truck 8"]');
   const card=row.locator('[data-schedule-appointment]').first();await card.waitFor();
   const scroller=page.locator('.schedule-board-scroll');
   if(mobile) {
    const css=await scroller.evaluate(n=>({x:getComputedStyle(n).overflowX,y:getComputedStyle(n).overscrollBehaviorY}));
    assert.equal(css.x,'auto');assert.equal(css.y,'auto','Vertical scroll chains to the page');
    assert.match(await card.evaluate(n=>getComputedStyle(n).touchAction),/pan-y|manipulation/);
    // Pointer events verify our handler leaves touch to the browser. These
    // dispatched events do not claim to exercise native WebKit swipe scrolling.
    await card.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:71,button:0,clientX:200,clientY:300});
    assert.equal(await page.locator('body.schedule-pointer-drag').count(),0,'Touch does not enter drag capture');
    await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointermove',{pointerType:'touch',pointerId:71,clientX:200,clientY:450,bubbles:true,cancelable:true})));
    assert.equal(await page.locator('.schedule-drag-preview').count(),0);
    await card.dispatchEvent('pointerup',{pointerType:'touch',pointerId:71,button:0});
    const session=name==='chromium'?await page.context().newCDPSession(page):null;
    for(const target of ['card','label','empty']) for(const axis of ['x','y']) {
     await page.goto(`${base}/tests/schedule-destinations.html?scenario=same-time`);await card.waitFor();
     await scroller.evaluate(n=>n.scrollLeft=0);await page.waitForTimeout(300);
     await row.scrollIntoViewIfNeeded();
     await row.evaluate(n=>window.scrollTo(0,scrollY+n.getBoundingClientRect().top-400));
     const loc=target==='card'?card:target==='label'?row.locator('.schedule-truck-cell'):row.locator('.live-truck-timeline');
     const box=await loc.boundingBox();
     const x=target==='empty'?Math.min(width-30,180):Math.min(width-30,box.x+box.width/2);
     const y=target==='empty'?box.y+box.height-5:box.y+Math.min(22,box.height/2);
     const before=await page.evaluate(()=>({x:document.querySelector('.schedule-board-scroll').scrollLeft,y:scrollY}));
     if(session) {
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let i=1;i<=10;i++) {await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-(axis==='x'?i*12:0),y:y-(axis==='y'?i*12:0)}]});await page.waitForTimeout(20);}
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
     } else {
      // WebKit wheel input requires the desktop engine at a phone width.
      // Mobile WebKit taps are checked separately; native swipes are unavailable.
      await page.mouse.move(x,y);await page.mouse.wheel(axis==='x'?180:0,axis==='y'?180:0);
     }
     await page.waitForTimeout(300);
     const after=await page.evaluate(()=>({x:document.querySelector('.schedule-board-scroll').scrollLeft,y:scrollY}));
     assert.ok(after[axis]>before[axis]+20,`${name} ${width} ${target} ${axis}: scrolling was blocked ${JSON.stringify({box,x,y,before,after})}`);
     assert.equal(await page.locator('.schedule-drag-preview').count(),0);
     assert.equal(await row.locator('[data-schedule-appointment][aria-pressed="true"]').count(),0,'Swiping does not select an appointment');
     assert.equal(await row.locator('.schedule-truck-cell').getAttribute('aria-pressed'),'false','Swiping does not select a truck');
     assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0','Swipes cannot submit a schedule move');
    }
    for(const index of [0,1,2,3]) {
     const target=row.locator('[data-schedule-appointment]').nth(index);await target.scrollIntoViewIfNeeded();await target.tap();
     assert.equal(await target.getAttribute('aria-pressed'),'true','A stationary tap opens the intended appointment');
     await page.locator('.schedule-appointment-summary').waitFor();
    }
    await row.scrollIntoViewIfNeeded();await scroller.evaluate(n=>n.scrollLeft=200);
    if(width===402)await page.screenshot({path:`${output}/${name}-402-horizontal.png`});
    await page.goto(`${base}/tests/schedule-destinations.html?scenario=dense`);
    await page.locator('[data-schedule-appointment]').first().waitFor();
    await scroller.evaluate(n=>window.scrollTo(0,scrollY+n.getBoundingClientRect().top-80));
    const last=page.locator('[data-schedule-truck="Unassigned"]');
    assert.ok((await last.boundingBox()).y+(await last.boundingBox()).height>874,'Dense day extends below the phone viewport');
    for(let attempt=0;attempt<8;attempt++) {
     const bottom=await last.evaluate(n=>n.getBoundingClientRect().bottom);
     if(bottom<=874) break;
     if(session) {
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:650}]});
      for(let step=1;step<=10;step++){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y:650-step*35}]});await page.waitForTimeout(20);}
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
     } else {await page.mouse.move(180,650);await page.mouse.wheel(0,350);}
     await page.waitForTimeout(300);
    }
    assert.ok(await last.evaluate(n=>n.getBoundingClientRect().bottom<=874),'Vertical scrolling reaches the bottom of the last truck on a dense day');
    assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
    if(width===402)await page.screenshot({path:`${output}/${name}-402-last-truck.png`});
   } else {
    assert.equal(await card.evaluate(n=>getComputedStyle(n).height),'22px','Desktop styling stays unchanged');
    await card.scrollIntoViewIfNeeded();await card.click();await page.locator('.schedule-appointment-summary').waitFor();
    await card.scrollIntoViewIfNeeded();const box=await card.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+50,box.y+box.height/2,{steps:5});
    assert.equal(await page.locator('body.schedule-pointer-drag').count(),1,'Mouse drag remains available');
    await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal(await page.locator('body.schedule-pointer-drag').count(),0);
   }
   assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');assert.deepEqual(errors,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,'Timeline overflow stays inside the board');
   if(name==='webkit' && mobile) {
    const phone=await browser.newPage({viewport:{width,height:874},hasTouch:true,isMobile:true});
    await phone.goto(`${base}/tests/schedule-destinations.html?scenario=same-time`);
    const phoneCard=phone.locator('[data-schedule-truck="Truck 8"] [data-schedule-appointment]').first();await phoneCard.waitFor();
    await phoneCard.scrollIntoViewIfNeeded();await phoneCard.tap();
    assert.equal(await phoneCard.getAttribute('aria-pressed'),'true','Mobile WebKit stationary taps select correctly');
    assert.equal(await phone.locator('#fixture-writes').innerText(),'Writes: 0');
    await phone.close();
   }
   console.log(`${name} ${width}: scrolling, taps, and zero moves passed`);await page.close();
  }
 } finally {await browser.close();}
}
console.log('Native Chromium swipes, WebKit native scrolling/taps and touch-handler checks, plus desktop mouse drag passed. Physical iPhone swipes require device acceptance.');
