import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../desktop-ui/node_modules/vite/dist/node/index.js';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'swipe-responsiveness-'));
const evidence=process.env.SWIPE_EVIDENCE_DIR;
const results=[];
const server=await createServer({configFile:path.join(root,'desktop-ui/tests/dashboard-hierarchy.vite.config.ts'),configLoader:'runner',cacheDir:cache,server:{host:'127.0.0.1',port:Number(process.env.SWIPE_TEST_PORT||3196),strictPort:true}});
let browser;
try {
 await server.listen();browser=await chromium.launch({headless:true});
 for(const cpu of [1,4]){
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.addInitScript(()=>{
   const audit={events:[],commits:[],measures:[],queries:[],errors:[],raf:[],longTasks:[],hints:[],hintFrames:[]};window.swipeAudit=audit;
   const original=EventTarget.prototype.addEventListener;
   EventTarget.prototype.addEventListener=function(type,callback,options){
    if(['touchstart','touchmove','touchend'].includes(type)&&this instanceof Element&&this.classList.contains('ops-content')){
     const listener=callback;
     callback=function(event){const began=performance.now();const x=event.touches[0]?.clientX;try{return typeof listener==='function'?listener.call(this,event):listener.handleEvent(event);}finally{audit.events.push({type,x,at:began,duration:performance.now()-began});}};
    }
    return original.call(this,type,callback,options);
   };
   const query=Document.prototype.querySelectorAll;
   Document.prototype.querySelectorAll=function(selector){const began=performance.now();const result=query.call(this,selector);if(selector.includes('dialog[open]'))audit.queries.push({at:began,duration:performance.now()-began,count:result.length});return result;};
   new PerformanceObserver(list=>audit.longTasks.push(...list.getEntries().map(({startTime,duration})=>({startTime,duration})))).observe({entryTypes:['longtask']});
   new PerformanceObserver(list=>audit.measures.push(...list.getEntries().map(({name,startTime,duration})=>({name,startTime,duration})))).observe({entryTypes:['measure']});
   addEventListener('error',event=>audit.errors.push(event.message));
   addEventListener('DOMContentLoaded',()=>{
    let prior='',priorHint='';
    new MutationObserver(()=>{const hint=document.querySelector('.mobile-navigation-hint')?.textContent||'';if(hint!==priorHint){priorHint=hint;audit.hints.push({label:hint,at:performance.now()});if(hint.startsWith('Opening '))requestAnimationFrame(()=>requestAnimationFrame(()=>audit.hintFrames.push({label:hint,at:performance.now(),stillVisible:document.querySelector('.mobile-navigation-hint')?.textContent===hint,workspace:document.querySelector('[aria-label="Choose workspace"]')?.value})));}const value=document.querySelector('[aria-label="Choose workspace"]')?.value;if(value&&value!==prior){prior=value;audit.commits.push({workspace:value,at:performance.now()});requestAnimationFrame(()=>requestAnimationFrame(()=>audit.raf.push({workspace:value,at:performance.now(),board:!!document.querySelector('.schedule-board-shell')})));}}).observe(document.documentElement,{childList:true,subtree:true,attributes:true});
   });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/desktop-assets/tests/integrated-gestures.html?date=2026-10-13&role=manager&performance=1`);
  await page.locator('.command-metrics').waitFor();
  const footer=page.locator('.command-footer > span');await footer.scrollIntoViewIfNeeded();await page.waitForTimeout(100);
  const bounds=await footer.boundingBox(),y=bounds.y+Math.min(bounds.height/2,12);
  await page.evaluate(()=>{window.swipeAudit.begin=performance.now();window.swipeAudit.readsBeforeTouch=[...window.gestureQa.reads];});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:270,y}]});
  for(const x of [250,230,210,190,170,150,130]){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});
   await page.waitForTimeout(16);
  }
  const beforeRelease=await page.getByLabel('Choose workspace').inputValue();
  await page.locator('.mobile-navigation-hint.next').waitFor();
  const beforeReleaseHint=await page.locator('.mobile-navigation-hint').innerText();
  const preloadedBeforeRelease=await page.evaluate(()=>performance.getEntriesByType('resource').some(entry=>new URL(entry.name).pathname.endsWith('/live-schedule.tsx')&&entry.startTime>=window.swipeAudit.begin));
  assert.equal(preloadedBeforeRelease,true,'Destination code request completes before release');
  assert.deepEqual(await page.evaluate(()=>window.gestureQa.reads),await page.evaluate(()=>window.swipeAudit.readsBeforeTouch),'Intent preloads code without starting snapshot requests');
  await page.waitForTimeout(200);
  await page.evaluate(()=>{window.swipeAudit.released=performance.now();});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Choose workspace"]').value==='Schedule');
  await page.locator('.schedule-board-shell').waitFor();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.mobile-navigation-hint').count(),0,'Accepted navigation clears hint after commit');
  const data=await page.evaluate(()=>({audit:window.swipeAudit,qa:window.gestureQa,resources:performance.getEntriesByType('resource').filter(entry=>/live-schedule|schedule-board|workspace-cache/.test(entry.name)).map(({name,startTime,duration})=>({name,startTime,duration}))}));
  const acknowledgment=data.audit.hints.find(event=>event.label.startsWith('Opening ')),acknowledgmentFrame=data.audit.hintFrames.find(event=>event.label.startsWith('Opening '));
  const touch=data.audit.events.filter(event=>event.at>=data.audit.begin),end=touch.find(event=>event.type==='touchend'),threshold=touch.find(event=>event.type==='touchmove'&&event.x<=174),commit=data.audit.commits.find(event=>event.workspace==='Schedule'),paint=data.audit.raf.find(event=>event.workspace==='Schedule'),ready=data.audit.measures.find(event=>event.name==='opscenter:Schedule:ready');
  assert.equal(beforeRelease,'Command','Page must not change while finger remains down');
  assert.equal(await page.getByLabel('Choose workspace').inputValue(),'Schedule');
  assert.deepEqual(data.qa.writes,[]);assert.deepEqual(data.audit.errors,[]);
  results.push({cpu,beforeRelease,beforeReleaseHint,preloadedBeforeRelease,releaseToAcknowledgment:acknowledgment?acknowledgment.at-data.audit.released:null,releaseToAcknowledgmentFrame:acknowledgmentFrame?acknowledgmentFrame.at-data.audit.released:null,acknowledgmentFrame,thresholdToRelease:threshold?data.audit.released-threshold.at:null,releaseToHandler:end?end.at-data.audit.released:null,handlerMs:end?.duration,releaseToCommit:commit.at-data.audit.released,releaseToPaint:paint?.at-data.audit.released,recordsReady:ready?.duration,events:touch,guardQueryCount:data.audit.queries.filter(event=>event.at>=data.audit.begin).length,guardQueryMs:data.audit.queries.filter(event=>event.at>=data.audit.begin).reduce((sum,event)=>sum+event.duration,0),resources:data.resources,longTasks:data.audit.longTasks.filter(event=>event.startTime>=data.audit.begin)});
  await page.close();
 }
 // Deterministic DOM touch integration covers shortened thresholds and safety guards.
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/desktop-assets/tests/mobile-gestures.html`);
 await page.locator('.mobile-interactions').waitFor();await page.waitForTimeout(50);
 const state=async()=>JSON.parse(await page.locator('#results').textContent());
 const gesture=async({selector='#swipe-space',points=[[270,30],[210,30]],duration=180,cancel=false}={})=>page.locator(selector).evaluate(async(el,{points,duration,cancel})=>{
  const top=el.getBoundingClientRect().top;
  const dispatch=(type,point)=>{const touch=new Touch({identifier:0,target:el,clientX:point[0],clientY:top+point[1]});el.dispatchEvent(new TouchEvent(type,{bubbles:true,touches:type==='touchend'||type==='touchcancel'?[]:[touch],changedTouches:[touch]}));};
  dispatch('touchstart',points[0]);
  for(const point of points.slice(1)){await new Promise(resolve=>setTimeout(resolve,duration/(points.length-1)));dispatch('touchmove',point);}
  await new Promise(resolve=>setTimeout(resolve,16));
  const before={active:JSON.parse(document.querySelector('#results').textContent).active,hint:document.querySelector('.mobile-navigation-hint')?.textContent||''};
  dispatch(cancel?'touchcancel':'touchend',points.at(-1));return before;
 },{points,duration,cancel});
 const accepted=async(value)=>{await page.waitForFunction(value=>JSON.parse(document.querySelector('#results').textContent).active===value,value);await page.locator('.mobile-navigation-hint').waitFor({state:'detached'});};
 let before=await gesture();assert.equal(before.active,'Command');assert.match(before.hint,/Command/);await accepted('Schedule');assert.equal((await state()).active,'Schedule','60px slow swipe accepted');
 await page.waitForTimeout(250);await gesture();await accepted('Krewe');assert.equal((await state()).active,'Krewe','Second deliberate swipe accepted after250ms');
 await page.waitForTimeout(250);await gesture({points:[[270,30],[230,30]],duration:40});await accepted('Fleet');assert.equal((await state()).active,'Fleet','40px fast flick accepted');
 await page.waitForTimeout(250);
 for(const scenario of [
  {points:[[270,30],[246,30]],duration:60},
  {points:[[270,30],[210,80]]},
  {points:[[270,30],[265,70],[180,70]]},
  {points:[[15,30],[100,30]]},
  {points:[[270,30],[210,30]],cancel:true},
  {points:[[270,30],[200,30],[262,30]]},
  {selector:'#map'}, {selector:'input'}, {selector:'#nested'}, {selector:'#carousel'}, {selector:'#drag'},
 ]){await gesture(scenario);assert.equal((await state()).active,'Fleet',`Rejected ${JSON.stringify(scenario)}`);assert.equal(await page.locator('.mobile-navigation-hint').count(),0,'Hint clears after rejected/cancelled gesture');}
 await page.getByRole('button',{name:'Busy: false'}).click();await gesture();assert.equal((await state()).active,'Fleet','Busy edits block navigation');await page.getByRole('button',{name:'Busy: true'}).click();
 await page.getByRole('button',{name:'Toggle drawer'}).click();await gesture();assert.equal((await state()).active,'Fleet','Unsaved drawer blocks navigation');await page.getByRole('button',{name:'Toggle drawer'}).click();
 await page.getByRole('textbox',{name:'Unsaved note'}).focus();await gesture();assert.equal((await state()).active,'Fleet','Focused unsaved input blocks navigation');await page.getByRole('textbox').evaluate(el=>el.blur());
 await gesture({cancel:true});assert.equal((await state()).active,'Fleet');
 assert.equal((await state()).opens,0);assert.equal((await state()).refreshes,0);
 await page.close();
 console.log('Short swipe safety PASS:60pxslow,40pxflick,repeat250ms,24px/diagonal/vertical/edge/map/input/nested/drag/busy/drawer rejection,cancel/reversal and no unintended refresh/action.');
 console.log(JSON.stringify(results,null,2));
 if(evidence){fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'swipe-latency.json'),JSON.stringify(results,null,2)+'\n');}
}finally{await browser?.close();await server.close();fs.rmSync(cache,{recursive:true,force:true});}
