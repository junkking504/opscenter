import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
const base=process.env.GESTURE_FIXTURE_URL||'http://127.0.0.1:3287';
for(const [name,engine] of Object.entries({chromium,webkit}))for(const reducedMotion of ['reduce','no-preference']){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion});
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto(`${base}/tests/mobile-gestures.html`);
  const current=async()=>JSON.parse(await page.locator('#results').textContent()).active;
  const picker=page.getByLabel('Choose workspace');
  const cdp=name==='chromium'?await page.context().newCDPSession(page):null;
  async function swipe(selector='#swipe-space',reverse=false,cancel=false){
   await page.locator(selector).scrollIntoViewIfNeeded();
   const b=await page.locator(selector).boundingBox(),y=b.y+Math.min(25,b.height/2),start=reverse?100:280,end=reverse?280:100;
   if(cdp){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});
    for(let i=1;i<=9;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start+(end-start)*i/9,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
   }else{
    // WebKit has no public remote swipe API: dispatch DOM touch-event sequences to the real component.
    await page.locator(selector).evaluate((el,{start,end,y,cancel})=>{
     const t=x=>({identifier:1,target:el,clientX:x,clientY:y});
     for(const [type,x] of [['touchstart',start],['touchmove',(start+end)/2],['touchmove',end],[cancel?'touchcancel':'touchend',end]]){
      const event=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperties(event,{touches:{value:type==='touchend'||type==='touchcancel'?[]:[t(x)]},changedTouches:{value:[t(x)]}});el.dispatchEvent(event);
     }
    },{start,end,y,cancel});
   }
  }
  await picker.focus();await picker.selectOption('Schedule');
  assert.ok(await picker.evaluate(e=>document.activeElement===e),'Regression requires retained native picker focus');
  await swipe();await page.waitForFunction(()=>JSON.parse(document.querySelector('#results').textContent).active==='Krewe');
  await page.waitForTimeout(300);await swipe('#swipe-space',true);await page.waitForFunction(()=>JSON.parse(document.querySelector('#results').textContent).active==='Schedule');
  await page.waitForTimeout(300);await picker.focus();await swipe('#swipe-space',false,true);assert.equal(await current(),'Schedule','Cancelled sequence stays put');
  await page.getByRole('button',{name:'Toggle drawer'}).click();await swipe();assert.equal(await current(),'Schedule','Open sheet/drawer still owns navigation');
  await page.getByRole('button',{name:'Toggle drawer'}).click();await picker.focus();await swipe();await page.waitForFunction(()=>JSON.parse(document.querySelector('#results').textContent).active==='Krewe');
  await page.waitForTimeout(300);await page.getByRole('textbox').focus();await swipe();assert.equal(await current(),'Krewe','Editable input still protects drafts');
  await page.getByRole('textbox').evaluate(e=>e.blur());
  await page.evaluate(()=>{const select=document.createElement('select');select.innerHTML='<option>Unsubmitted edit</option>';document.querySelector('main').append(select);select.focus();});
  await swipe();assert.equal(await current(),'Krewe','Ordinary select remains an edit guard');
  await page.evaluate(()=>document.activeElement.blur());
  console.log(`${name} ${reducedMotion}: retained picker focus, repeated/reverse/cancelled touches, open/closed drawer and draft guards PASS`);
 }finally{await browser.close()}
}
