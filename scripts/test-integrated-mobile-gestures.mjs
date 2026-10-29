import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.GESTURE_INTEGRATION_URL||'http://127.0.0.1:3189/desktop-assets/tests/integrated-gestures.html';
const evidence=process.env.GESTURE_EVIDENCE_DIR;
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
 page.setDefaultTimeout(30000);
 const errors=[];page.on('pageerror',error=>{if(!errors.includes(error.message))errors.push(error.message);});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const cdp=await page.context().newCDPSession(page);
 const current=()=>page.getByLabel('Choose workspace').inputValue();
 const qa=()=>page.evaluate(()=>window.gestureQa);
 const pull=async(locator)=>{
  await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let dy=20;dy<=120;dy+=20)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+dy}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 };
 const syntheticSwipe=async(direction=1,selector='.workspace',cancel=false)=>{
  await page.locator(selector).first().evaluate((el,{direction,cancel})=>{
   const y=200,start=direction===1?260:100,end=direction===1?100:260;
   const event=(type,x)=>el.dispatchEvent(new TouchEvent(type,{bubbles:true,touches:x===null?[]:[new Touch({identifier:0,target:el,clientX:x,clientY:y})]}));
   event('touchstart',start);event('touchmove',end);event(cancel?'touchcancel':'touchend',null);
  },{direction,cancel});
 };
 for(const role of ['manager','operator']){
  const precedingUrl=page.url();
  await page.goto(`${base}?date=2026-10-13&role=${role}`);await page.locator('.command-metrics').waitFor();
  const historyLength=await page.evaluate(()=>history.length);
  const expected=role==='manager'?['Dashboard','Command','Krewe','Fleet','Finance','Marketing','Settings']:['Dashboard','Command','Krewe','Fleet','Marketing','Settings'];
  assert.deepEqual(await page.getByLabel('Choose workspace').locator('option').allTextContents(),expected);
  const hero=page.locator('.hero-value');await hero.scrollIntoViewIfNeeded();const box=await hero.boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+40,y:box.y+20}]});
  await page.getByRole('dialog',{name:'Metric preview'}).waitFor();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.match(await page.getByRole('dialog').textContent(),/Revenue.*\$8,512\.34/);assert.match(await page.getByRole('dialog').textContent(),/Includes assumed daily costs/);
  assert.equal(await current(),'Command','hold must not activate revenue drilldown');
  const previewBox=await page.getByRole('dialog').boundingBox();assert.ok(previewBox.x>=12 && previewBox.y>=12 && previewBox.x+previewBox.width<=378 && previewBox.y+previewBox.height<=832,'preview stays inside viewport with intentional margin');
  assert.ok(Math.abs(previewBox.x+previewBox.width/2-195)<2,'preview centered despite global CSS');
  if(evidence && role==='manager')await page.screenshot({path:`${evidence}/integrated-revenue-preview.png`});
  await pull(page.getByRole('dialog').getByRole('button',{name:'Close details',exact:true}));await page.getByRole('dialog').waitFor({state:'detached'});
  assert.equal(await hero.evaluate(el=>document.activeElement===el),true,'metric focus returns');
  await page.getByRole('button',{name:'Preview metrics',exact:true}).click();
  assert.equal(await page.locator('.mobile-preview-dialog dl > div').count(),7,'all KPI values available');
  await page.keyboard.press('Escape');
  let before=(await qa()).reads.filter(url=>url.startsWith('/api/desktop/command')).length;
  await page.locator('.mobile-interactions').getByRole('button',{name:'Refresh data',exact:true}).click();
  await page.waitForFunction(count=>window.gestureQa.reads.filter(url=>url.startsWith('/api/desktop/command')).length>count,before);
  await page.getByRole('searchbox').first().focus();await syntheticSwipe();assert.equal(await current(),'Command','focused search cancels workspace swipe');await page.getByRole('searchbox').first().evaluate(el=>el.blur());
  await syntheticSwipe(1,'.workspace',true);assert.equal(await current(),'Command','touchcancel does not navigate');
  // iOS may keep the workspace picker focused after its native popup closes.
  await page.getByLabel('Choose workspace').focus();
  await page.getByLabel('Choose workspace').selectOption('Command');
  assert.equal(await page.getByLabel('Choose workspace').evaluate(el=>el===document.activeElement),true);
  // Genuine browser touch on non-control footer text confirms the integrated root listener.
  const footer=page.locator('.command-footer > span');await footer.scrollIntoViewIfNeeded();const f=await footer.boundingBox();
  const y=f.y+Math.min(f.height/2,12);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:260,y}]});
  for(let x=240;x>=100;x-=20)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Choose workspace"]').value==='Schedule');
  await page.locator('.schedule-board-shell').waitFor();
  const refresh=page.locator('.mobile-interactions').getByRole('button',{name:'Refresh data',exact:true});await refresh.waitFor();
  before=(await qa()).reads.filter(url=>url.includes('displayOnly=1')).length;
  await pull(refresh);await page.waitForFunction(count=>window.gestureQa.reads.filter(url=>url.includes('displayOnly=1')).length>count,before);
  assert.equal((await qa()).reads.filter(url=>url.includes('displayOnly=1')).every(url=>!url.includes('load=1')&&!url.includes('refresh=1')),true);
  await refresh.waitFor();assert.equal(await page.getByRole('button',{name:'Refresh day',exact:true}).isDisabled(),true,'pending source-request state retained');
  const details=page.getByRole('button',{name:/View details/}).first();
  await details.click();await page.locator('.job-record-drawer').waitFor();
  await syntheticSwipe();assert.equal(await current(),'Schedule','record drawer blocks main navigation');
  assert.equal(await page.locator('.mobile-interactions').getByRole('button',{name:'Refresh data',exact:true}).count(),0,'record review blocks refresh registration');
  if(evidence && role==='manager'){await page.waitForTimeout(250);await page.screenshot({path:`${evidence}/integrated-appointment-detail.png`});}
  await pull(page.locator('.job-record-drawer').getByRole('button',{name:'Close details',exact:true}));await page.locator('.job-record-drawer').waitFor({state:'detached'});
  await page.getByLabel('Choose workspace').selectOption('Command');await page.getByLabel('Choose workspace').evaluate(el=>el.blur());await page.waitForTimeout(700);
  const order=role==='manager'?['Schedule','Krewe','Fleet','Finance','Marketing','Settings']:['Schedule','Krewe','Fleet','Marketing','Settings'];
  for(const workspace of order){await syntheticSwipe();await page.waitForFunction(value=>document.querySelector('[aria-label="Choose workspace"]').value===value,workspace);await page.waitForTimeout(700);}
  await syntheticSwipe();assert.equal(await current(),'Settings','last workspace does not wrap');
  await page.waitForTimeout(700);await syntheticSwipe(-1);await page.waitForFunction(value=>document.querySelector('[aria-label="Choose workspace"]').value===value,'Marketing');assert.equal(await current(),'Marketing','reverse sidebar order');
  assert.deepEqual((await qa()).writes,[],'no operational action activated');
  assert.equal(await page.evaluate(()=>history.length),historyLength,'Workspace swipes preserve existing replace-state history behavior');
  assert.equal(new URL(page.url()).searchParams.get('workspace'),'Marketing','URL tracks the final workspace');
  await page.goBack();assert.equal(page.url(),precedingUrl,'Browser back retains the preceding document');
  await page.goForward();await page.waitForFunction(()=>document.querySelector('[aria-label="Choose workspace"]')?.value==='Marketing');
  assert.deepEqual((await qa()).writes,[],'History restoration has no operational actions');
 }
 await page.goto(`${base}?date=2026-10-13&role=manager`);await page.locator('.command-metrics').waitFor();
 await page.getByRole('switch',{name:'Dark mode',exact:true}).click();
 assert.equal(await page.locator('html').getAttribute('data-ops-theme'),'dark');
 await page.getByRole('button',{name:'Preview metrics',exact:true}).click();await page.getByRole('dialog').waitFor();
 const theme=await page.getByRole('dialog').evaluate(el=>({background:getComputedStyle(el).backgroundColor,text:getComputedStyle(el).color}));
 assert.notEqual(theme.background,'rgb(255, 255, 255)','preview uses dark raised surface');
 if(evidence)await page.screenshot({path:`${evidence}/integrated-preview-dark.png`});
 await page.locator('.mobile-preview-dialog dl > div').last().scrollIntoViewIfNeeded();
 const lastPreview=await page.locator('.mobile-preview-dialog dl > div').last().boundingBox();assert.ok(lastPreview.y>=0 && lastPreview.y+lastPreview.height<=844,'last metric remains scroll-accessible');
 if(evidence)await page.screenshot({path:`${evidence}/integrated-preview-dark-scroll.png`});
 await page.keyboard.press('Escape');await page.getByRole('switch',{name:'Dark mode',exact:true}).click();
 assert.deepEqual(errors,[],'no runtime errors');
 console.log('Integrated Home gestures PASS: Manager/Operator order, seven KPI previews, actual touch/hold/pull/dismiss, safe Dashboard/Command reads, search/cancel/drawer guards, zero operational actions.');
}finally{await browser.close();}
