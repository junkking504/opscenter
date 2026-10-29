import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
const base=process.env.GESTURE_FIXTURE_URL||'http://127.0.0.1:3192/desktop-assets';
for(const [name,engine] of Object.entries({chromium,webkit})){
 const browser=await engine.launch({headless:true});
 try{
  for(const reducedMotion of ['reduce','no-preference']){
   const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
   await page.addInitScript(()=>{
    // Desktop WebKit exposes TouchEvent but no constructible Touch. Populate
    // its read-only lists for DOM-dispatched recognition tests; this is not
    // native iOS input. Chromium native coverage is separate below.
    window.qaTouchEvent=(el,type,points,ended=false)=>{
     const list=points.map((p,i)=>({identifier:i+1,target:el,clientX:p[0],clientY:p[1]}));
     const event=new TouchEvent(type,{bubbles:true,cancelable:true});
     Object.defineProperties(event,{touches:{value:ended?[]:list},changedTouches:{value:list}});
     el.dispatchEvent(event);
    };
   });
   await page.goto(`${base}/tests/mobile-gestures.html`);
   const state=async()=>JSON.parse(await page.locator('#results').textContent());
   const reset=async()=>{await page.getByLabel('Choose workspace').selectOption('Command');await page.getByLabel('Choose workspace').evaluate(el=>el.blur());await page.waitForTimeout(240);};
   // Full touch sequence, including changedTouches on release. WebKit is DOM
   // dispatched, not hardware input; Chromium also gets native CDP below.
   const gesture=async(selector,points,options={})=>{
    await page.locator(selector).evaluate((el,{points,options})=>{
     const top=el.getBoundingClientRect().top;
     const send=(type,p)=>window.qaTouchEvent(el,type,options.multi?[[p[0],top+p[1]],[p[0]+15,top+p[1]]]:[[p[0],top+p[1]]],type==='touchend'||type==='touchcancel');
     send('touchstart',points[0]);for(const p of points.slice(1))send('touchmove',p);
     if(options.scroll)window.dispatchEvent(new Event('scroll'));
     send(options.cancel?'touchcancel':'touchend',points.at(-1));
    },{points,options});
   };
   for(const selector of ['#action-card','#action-card svg circle','#content-link','#disclosure','#metric','#nested','#selection']){
    await reset();const before=(await state()).opens;
    await gesture(selector,[[260,10],[225,11],[110,13]]);
    await page.waitForFunction(()=>JSON.parse(document.querySelector('#results').textContent).active==='Schedule');
    await page.locator(selector).evaluate(el=>el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1})));
    assert.equal((await state()).opens,before,`${name} ${selector}: swipe must not click`);
    assert.equal(await page.locator('details').filter({has:page.locator('#disclosure')}).getAttribute('open'),null,'swipe must not open disclosure');
    assert.equal(new URL(page.url()).hash,'','swipe must not follow link');
   }
   for(const [selector,points,options] of [
    ['#action-card',[[260,10],[245,11]],{}],
    ['#action-card',[[260,10],[200,55]],{}],
    ['#action-card',[[260,10],[250,40],[100,42]],{}],
    ['#action-card',[[260,10],[190,12],[252,12]],{}],
    ['#action-card',[[260,10],[110,12]],{cancel:true}],
    ['#action-card',[[260,10],[110,12]],{multi:true}],
    ['#action-card',[[260,10],[110,12]],{scroll:true}],
    ['#action-card',[[10,10],[180,12]],{}],
    ...['input','#map','#carousel','#drag','#nested-owned'].map(s=>[s,[[260,10],[110,12]],{}]),
   ]){await reset();await gesture(selector,points,options);assert.equal((await state()).active,'Command',`${name} protected/cancelled ${selector} ${JSON.stringify(options)} ${JSON.stringify(points)}`);}
   await reset();await page.getByRole('textbox').focus();await gesture('#action-card',[[260,10],[110,12]]);assert.equal((await state()).active,'Command','unsaved edit focus protected');await page.getByRole('textbox').evaluate(el=>el.blur());
   await page.getByRole('button',{name:'Toggle drawer'}).click();await gesture('#action-card',[[260,10],[110,12]]);assert.equal((await state()).active,'Command','drawer protected');await page.getByRole('button',{name:'Toggle drawer'}).click();
   await page.locator('#selection').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);window.getSelection().removeAllRanges();window.getSelection().addRange(range);});assert.equal(await page.evaluate(()=>window.getSelection().toString()),'Selectable description');await gesture('#action-card',[[260,10],[110,12]]);assert.equal((await state()).active,'Command','selection protected');await page.evaluate(()=>window.getSelection().removeAllRanges());
   await gesture('#action-card',[[260,10],[110,12]]);await page.waitForFunction(()=>JSON.parse(document.querySelector('#results').textContent).active==='Schedule');await gesture('#action-card',[[260,10],[110,12]]);assert.equal((await state()).active,'Schedule','rapid repeat protected');
   // New tap after swipe is never swallowed; keyboard activation remains valid.
   let before=(await state()).opens;await page.locator('#action-card').tap();assert.equal((await state()).opens,before+1,'fresh tap works');
   await page.locator('#action-card').focus();await page.keyboard.press('Enter');assert.equal((await state()).opens,before+2,'keyboard works');
   await reset();before=(await state()).opens;await page.locator('#metric').tap();assert.equal((await state()).opens,before+1,'metric tap works');
   await page.locator('#metric').evaluate(el=>{window.qaTouchEvent(el,'touchstart',[[100,100]]);});await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
   if(name==='chromium'){
    await reset();await page.locator('#action-card').scrollIntoViewIfNeeded();const box=await page.locator('#action-card').boundingBox();const cdp=await page.context().newCDPSession(page);before=(await state()).opens;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:280,y:box.y+25}]});
    for(const x of [250,220,190,150,100])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:box.y+27}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(()=>JSON.parse(document.querySelector('#results').textContent).active==='Schedule');assert.equal((await state()).opens,before,'native swipe button never activates');
   }
   await reset();await page.setViewportSize({width:844,height:390});await gesture('#action-card',[[260,10],[110,12]]);await page.waitForFunction(()=>JSON.parse(document.querySelector('#results').textContent).active==='Schedule');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'landscape no horizontal overflow');
   await reset();await page.setViewportSize({width:1200,height:900});await gesture('#action-card',[[260,10],[110,12]]);assert.equal((await state()).active,'Command','desktop touch does not page-swipe');
   await page.setViewportSize({width:390,height:844});
   if(process.env.GESTURE_EVIDENCE_DIR)await page.screenshot({path:`${process.env.GESTURE_EVIDENCE_DIR}/${name}-${reducedMotion}-content-swipe.png`,fullPage:true});
   assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${name} ${reducedMotion}: content controls, release click, vertical/diagonal/cancel/multitouch, ownership, edit/dialog/selection, repeats, taps/keyboard/hold${name==='chromium'?', native CDP button swipe':''}`);
  }
 }finally{await browser.close();}
}
