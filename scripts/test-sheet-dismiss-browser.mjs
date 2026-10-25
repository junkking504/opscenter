import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../desktop-ui/node_modules/vite/dist/node/index.js';
import {chromium,webkit} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'sheet-dismiss-'));
const evidence=process.env.DISMISS_EVIDENCE_DIR;
if(evidence)fs.mkdirSync(evidence,{recursive:true});
const server=await createServer({configFile:path.join(root,'desktop-ui/tests/dashboard-hierarchy.vite.config.ts'),configLoader:'runner',cacheDir:cache,server:{host:'127.0.0.1',port:3196,strictPort:true}});
const results=[];
try{
 await server.listen();
 for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/desktop-assets/tests/sheet-dismiss.html`);
   const handle=page.locator('button.mobile-sheet-dismiss');await handle.waitFor();
   const cdp=engine==='chromium'?await page.context().newCDPSession(page):null;
   const state=()=>page.locator('#results').textContent().then(JSON.parse);
   const reset=async()=>{await page.locator('#disabled').uncheck();if(!(await state()).open)await page.locator('#open').click();await handle.waitFor();await page.waitForTimeout(50);};
   const move=async({dx=0,dy=80,ms=180,cancel=false,multi=false,lost=false,selector='button.mobile-sheet-dismiss',fraction=0.5}={})=>{
    const locator=page.locator(selector),b=await locator.boundingBox(),x=b.x+b.width*fraction,y=b.y+b.height/2;
    if(lost)await locator.evaluate(el=>el.addEventListener('pointerdown',event=>{window.dismissPointerId=event.pointerId;},{once:true}));
    if(cdp){
     await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x,y}]});
     for(let i=1;i<=5;i++){await page.waitForTimeout(ms/5);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:0,x:x+dx*i/5,y:y+dy*i/5},...(multi?[{id:1,x:x+35,y:y+dy*i/5}]:[])]});if(lost&&i===2)await locator.evaluate(el=>el.releasePointerCapture(window.dismissPointerId));}
     await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
    }else{
     // WebKit lacks a public native touch-drag API. This tests handler semantics only.
     await locator.evaluate(async(el,{x,y,dx,dy,ms,cancel,multi,lost})=>{
      const emit=(type,i)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:1,isPrimary:true,clientX:x+dx*i/5,clientY:y+dy*i/5}));
      emit('pointerdown',0);
      if(multi){const event=new Event('touchstart',{bubbles:true});Object.defineProperty(event,'touches',{value:[{identifier:1,target:el,clientX:x,clientY:y},{identifier:2,target:el,clientX:x+35,clientY:y}]});el.dispatchEvent(event);}
      for(let i=1;i<=5;i++){await new Promise(r=>setTimeout(r,ms/5));emit('pointermove',i);if(lost&&i===2)emit('lostpointercapture',i);}
      emit(cancel?'pointercancel':'pointerup',5);
     },{x,y,dx,dy,ms,cancel,multi,lost});
    }
    await page.waitForTimeout(100);
   };
   const geometry=await handle.evaluate(el=>({width:el.getBoundingClientRect().width,row:el.parentElement.clientWidth-parseFloat(getComputedStyle(el.parentElement).paddingLeft)-parseFloat(getComputedStyle(el.parentElement).paddingRight),height:el.getBoundingClientRect().height,touchAction:getComputedStyle(el).touchAction}));
   assert.notEqual(await page.locator('.sheet-grip').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','Grab affordance visibly painted');
   assert.ok(geometry.width>=geometry.row-4,'Entire advertised handle row is tappable');
   assert.ok(geometry.width<=390-24,'Handle fits mobile viewport');
   assert.ok(geometry.height>=44,'Handle has comfortable touch height');
   assert.equal(geometry.touchAction,'pan-x pinch-zoom','Zoom preserved on dedicated control');
   for(const fraction of [0.1,0.5,0.9]){await reset();const before=(await state()).dismisses;await move({fraction});assert.equal((await state()).open,false,`${engine}:80px drag at ${fraction} closes`);assert.equal((await state()).dismisses,before+1,'Exactly one dismissal');assert.equal((await state()).underlyingClicks,0,'Dismissal never clicks through to underlying action');}
   await reset();await move({ms:1100});assert.equal((await state()).open,false,'Deliberate1100ms drag still closes');
   for(const [name,options] of [['short',{dy:40}],['upward',{dy:-80}],['diagonal',{dy:80,dx:80}],['cancel',{cancel:true}],['lost capture',{lost:true}],['multitouch',{multi:true}],['expired',{ms:1700}]]){
    await reset();const before=(await state()).dismisses;await move(options);assert.equal((await state()).open,true,`${engine}:${name} does not dismiss`);assert.equal((await state()).dismisses,before,`${name} has no action`);
   }
   await reset();await page.locator('#disabled').check();await move();assert.equal((await state()).open,true,'Disabled drag does not dismiss');await page.locator('#disabled').uncheck();
   const before=(await state()).dismisses;
   await move({selector:'.body',dy:-100});assert.equal((await state()).open,true,'Body scrolling never dismisses');
   if(cdp)assert.ok(await page.locator('.body').evaluate(el=>el.scrollTop)>0,'Real body touch scroll still works');
   await page.waitForTimeout(750);await handle.click();assert.equal((await state()).dismisses,before+1,'Visible click alternative dismisses');
   await reset();await move();await page.locator('#open').focus();await page.keyboard.press('Enter');assert.equal((await state()).open,true,'Intentional keyboard reopening is not blocked by touch release suppression');
   await reset();await handle.focus();await page.keyboard.press('Enter');assert.equal((await state()).open,false,'Keyboard alternative dismisses');
   await reset();await move({cancel:true});const tapBox=await handle.boundingBox();await page.touchscreen.tap(tapBox.x+tapBox.width/2,tapBox.y+tapBox.height/2);assert.equal((await state()).open,false,'Fresh deliberate touch tap works immediately after cancellation');
   await reset();await move({cancel:true});await page.waitForTimeout(750);await move();assert.equal((await state()).open,false,'Fresh drag works after cancellation');
   assert.deepEqual(errors,[],'No browser runtime errors');
   if(evidence){fs.mkdirSync(evidence,{recursive:true});await reset();await page.screenshot({path:path.join(evidence,`${engine}-dismiss-handle.png`)});}
   results.push({engine,input:cdp?'real CDP touch':'synthetic pointer semantics; not native iPhone touch',geometry,passed:true});
  }finally{await browser.close();}
 }
}finally{await server.close();fs.rmSync(cache,{recursive:true,force:true});if(evidence)fs.writeFileSync(path.join(evidence,'dismiss-regression.json'),JSON.stringify(results,null,2));}
console.log('Sheet dismissal regression PASS',results);
