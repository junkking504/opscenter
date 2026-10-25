import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.GESTURE_FIXTURE_URL||'http://127.0.0.1:3192/desktop-assets';
const evidence=process.env.GESTURE_EVIDENCE_DIR;
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`${base}/tests/mobile-gestures.html`);
 const cdp=await page.context().newCDPSession(page);
 const state=async()=>JSON.parse(await page.locator('#results').textContent());
 const touch=async(selector,points,{cancel=false,multi=false}={})=>{
  await page.locator(selector).evaluate((el,{points,cancel,multi})=>{
   const box=el.getBoundingClientRect();
   const dispatch=(type,list)=>el.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:list.map((p,i)=>new Touch({identifier:i,target:el,clientX:p[0],clientY:box.top+p[1]})),changedTouches:[]}));
   dispatch('touchstart',[points[0]]);
   for(const p of points.slice(1))dispatch('touchmove',multi?[p,[p[0]+30,p[1]+20]]:[p]);
   dispatch(cancel?'touchcancel':'touchend',[]);
  },{points,cancel,multi});
 };
 const swipe=()=>touch('#swipe-space',[[250,30],[130,32]]);
 const space=await page.locator('#swipe-space').boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:280,y:space.y+30}]});
 for(let x=260;x>=120;x-=20)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:space.y+30}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(()=>JSON.parse(document.querySelector('#results').textContent).active==='Schedule');
 assert.equal((await state()).active,'Schedule','browser-generated touch navigates');
 await page.waitForFunction(()=>document.activeElement===document.querySelector('h1'));
 assert.equal(await page.locator('h1').evaluate(el=>document.activeElement===el),true,'new heading focused');
 await swipe();assert.equal((await state()).active,'Schedule','repeat gesture suppressed');
 await page.waitForTimeout(700);
 for(const [selector,points,options] of [
  ['#swipe-space',[[15,30],[150,30]],{}],
  ['#swipe-space',[[250,30],[226,30]],{}],
  ['#swipe-space',[[250,30],[240,80],[100,80]],{}],
  ['#swipe-space',[[250,30],[100,30]],{cancel:true}],
  ['#swipe-space',[[250,30],[100,30]],{multi:true}],
  ['#nested',[[250,30],[100,30]],{}],
  ['#carousel',[[250,30],[100,30]],{}],
  ['#map',[[250,10],[100,10]],{}],
  ['#drag',[[250,10],[100,10]],{}],
  ['input',[[250,10],[100,10]],{}],
  ['#metric',[[250,10],[100,10]],{}],
 ]){await touch(selector,points,options);assert.equal((await state()).active,'Schedule',`excluded/cancelled ${selector} ${JSON.stringify(points)}`);}
 await page.getByRole('button',{name:'Busy: false'}).click();await swipe();assert.equal((await state()).active,'Schedule','busy suppresses navigation');await page.getByRole('button',{name:'Busy: true'}).click();
 await page.getByRole('button',{name:'Toggle drawer'}).click();await swipe();assert.equal((await state()).active,'Schedule','unsaved drawer suppresses navigation');await page.getByRole('button',{name:'Toggle drawer'}).click();
 await page.getByRole('textbox',{name:'Unsaved note'}).focus();await swipe();assert.equal((await state()).active,'Schedule','focused form suppresses navigation');await page.getByRole('textbox').evaluate(el=>el.blur());
 await page.locator('#selection').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=window.getSelection();s.removeAllRanges();s.addRange(r);});await swipe();assert.equal((await state()).active,'Schedule','text selection suppresses navigation');await page.evaluate(()=>window.getSelection().removeAllRanges());
 await page.locator('#metric').evaluate(el=>{const box=el.getBoundingClientRect();el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[new Touch({identifier:0,target:el,clientX:box.left+30,clientY:box.top+20})]}));});
 await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').textContent(),/Revenue.*\$125/);
 await page.locator('#metric').evaluate(el=>el.click());assert.equal((await state()).opens,0,'hold consumes following click');
 await page.keyboard.press('Escape');assert.equal(await page.locator('#metric').evaluate(el=>document.activeElement===el),true,'preview focus returns');
 const metricBox=await page.locator('#metric').boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:metricBox.x+30,y:metricBox.y+20}]});
 await page.getByRole('dialog').waitFor();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForTimeout(100);assert.equal(await page.getByRole('dialog').count(),1,'actual hold-release keeps preview open');
 await page.mouse.click(2,2);await page.getByRole('dialog').waitFor({state:'detached'});
 assert.equal((await state()).opens,0,'hold-release never invokes underlying action');
 await page.getByRole('button',{name:'Preview metrics'}).click();await page.getByRole('dialog').waitFor();
 if(evidence)await page.screenshot({path:`${evidence}/metric-preview-mobile.png`,fullPage:true});
 async function pull(locator,distance=120,dx=0){const box=await locator.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let dy=20;dy<=distance;dy+=20)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*dy/distance,y:y+dy}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 await pull(page.getByRole('button',{name:'Close details',exact:true}));await page.getByRole('dialog').waitFor({state:'detached'});
 assert.equal(await page.getByRole('button',{name:'Preview metrics'}).evaluate(el=>document.activeElement===el),true);
 await pull(page.getByRole('button',{name:'Refresh data',exact:true}),60);await page.waitForTimeout(200);assert.equal((await state()).refreshes,0,'short pull must not become click');
 await page.waitForTimeout(700);await pull(page.getByRole('button',{name:'Refresh data',exact:true}),120,120);await page.waitForTimeout(200);assert.equal((await state()).refreshes,0,'diagonal pull must not become click');
 await page.waitForTimeout(700);await pull(page.getByRole('button',{name:'Refresh data',exact:true}));await page.waitForTimeout(200);assert.equal((await state()).refreshes,1,'dedicated pull refresh exactly once');
 await page.waitForTimeout(700);await page.getByRole('button',{name:'Refresh data',exact:true}).click();await page.waitForTimeout(200);assert.equal((await state()).refreshes,2,'visible refresh alternative');
 await page.getByLabel('Choose workspace').selectOption('Fleet');await page.waitForTimeout(700);await swipe();await page.waitForFunction(()=>JSON.parse(document.querySelector('#results').textContent).active==='Marketing');assert.equal((await state()).active,'Marketing','hidden Finance skipped');await page.waitForTimeout(700);await swipe();assert.equal((await state()).active,'Marketing','last page does not wrap');
 await page.getByLabel('Choose workspace').selectOption('Command');await page.waitForTimeout(700);await touch('#swipe-space',[[100,30],[230,30]]);assert.equal((await state()).active,'Command','first page does not wrap');
 if(evidence)await page.screenshot({path:`${evidence}/gesture-controls-mobile.png`,fullPage:true});
 await page.setViewportSize({width:1200,height:900});await swipe();assert.equal((await state()).active,'Command','desktop gestures disabled');
 assert.equal(await page.locator('.mobile-interactions').isVisible(),false);
 assert.equal(await page.locator('.mobile-pull-control').evaluate(el=>getComputedStyle(el).touchAction),'pan-x pinch-zoom','zoom stays enabled on dedicated handle');
 console.log('Mobile gesture browser PASS: navigation, exclusions, cancellation, busy/drafts, permission ordering, long-hold/focus, CDP pull/dismiss, visible alternatives. Synthetic data; no external requests.');
}finally{await browser.close();}
