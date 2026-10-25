import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../desktop-ui/node_modules/vite/dist/node/index.js';
import {chromium,webkit} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=process.env.APPOINTMENT_SUMMARY_OUTPUT;
if(output)fs.mkdirSync(output,{recursive:true});
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'appointment-summary-'));
const server=await createServer({configFile:path.join(root,'desktop-ui/vite.opscenter.config.ts'),configLoader:'runner',cacheDir:cache,base:'/',server:{host:'127.0.0.1',port:0},plugins:[{name:'summary-fixture-map',enforce:'pre',load(id){if(id.endsWith('/desktop-ui/schedule-map.tsx'))return 'export default function Map(){return <div aria-label="Synthetic map placeholder">Map omitted from this isolated appointment test.</div>}';}}]});
const results=[];
try{
 await server.listen();
 for(const [engineName,engine] of Object.entries(process.env.SUMMARY_BROWSER==='webkit'?{webkit}:process.env.SUMMARY_BROWSER==='chromium'?{chromium}:{chromium,webkit})){
  const browser=await engine.launch({headless:true});
  try{
   for(const [width,height,theme] of (process.env.SUMMARY_SMOKE?[[390,844,'light']]:[[390,844,'light'],[390,844,'dark'],[320,640,'dark'],[844,390,'dark']]))for(const scenario of (process.env.SUMMARY_SMOKE?['long']:['long','missing','warning'])){
    const page=await browser.newPage({viewport:{width,height},hasTouch:true,reducedMotion:'reduce'});
    const errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(value=>localStorage.setItem('opscenter.theme.v1',value),theme);
    await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'||url.pathname.startsWith('/api/')){network.push(url.pathname);return route.abort();}return route.continue();});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/appointment-summary.html?case=${scenario}`,{waitUntil:'networkidle'});
    const card=page.locator('[data-schedule-appointment]:visible').first();await card.waitFor();
    const calls=()=>page.evaluate(()=>window.summaryFixtureCalls);
    const baseline=(await calls()).length;
    await card.tap();
    const summary=page.locator('.appointment-summary-dialog');await summary.waitFor({state:'visible'});
    assert.equal(await page.locator('.job-record-drawer').count(),0,'Initial tap must not mount operational detail components');
    assert.equal(await summary.locator('input,textarea,select').count(),0,'Summary is read-only');
    const summaryCalls=(await calls()).slice(baseline);
    assert.ok(summaryCalls.every(call=>call.method==='GET'&&!/closeout|cost|history|customer|prepare|operations/.test(call.path)),`Summary must not prepare full detail operations: ${JSON.stringify(summaryCalls)}`);
    const text=await summary.innerText();assert.match(text,/JKSYNTHETIC/);
    if(scenario==='long'){assert.match(text,/Synthetic Customer/);assert.match(text,/Example Boulevard/);assert.match(text,/side entrance/i);}
    if(scenario==='missing'){assert.match(text,/Address unavailable/);assert.match(text,/Time not recorded/);assert.match(text,/Payment updating/);assert.doesNotMatch(text,/\$0\.00/);}
    if(scenario==='warning'){assert.match(text,/Assignment not verified/);assert.match(text,/No payment recorded/);assert.doesNotMatch(text,/Payment details unavailable/);}
    const layout=await summary.evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,client:e.clientWidth,scroll:e.scrollWidth,page:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight};});
    assert.ok(layout.left>=-1&&layout.right<=width+1&&layout.top>=-1&&layout.bottom<=height+1,JSON.stringify(layout));
    assert.ok(layout.scroll<=layout.client+1,'Long summary values must wrap without horizontal overflow');
    if(output)await page.screenshot({path:path.join(output,`${engineName}-${theme}-${width}x${height}-${scenario}-compact.png`),fullPage:false});
    if(scenario!=='missing'){await summary.getByText('Request and notes',{exact:true}).click();assert.match(await summary.innerText(),/complete source request remains available/);}
    await summary.getByRole('button',{name:'Full details',exact:true}).focus();
    const keyboardFocus=[];for(let index=0;index<7;index++){await page.keyboard.press('Tab');const focus=await summary.evaluate(e=>({inside:e.contains(document.activeElement),body:document.activeElement===document.body,tag:document.activeElement?.tagName}));keyboardFocus.push(focus);assert.ok(focus.inside||focus.body,'Native modal must not focus background page controls');}
    const contrast=await summary.evaluate(dialog=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');
      const rgba=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data];};
      const mix=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]/255+b[i]*(1-a[3]/255));
      const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      return [...dialog.querySelectorAll('p,h2,dt,dd,strong,small,summary,button')].filter(e=>e.textContent.trim()&&e.getClientRects().length).map(e=>{const style=getComputedStyle(e),chain=[];for(let node=e;node;node=node.parentElement)chain.push(rgba(getComputedStyle(node).backgroundColor));let bg=[255,255,255];for(const color of chain.reverse())bg=mix(color,bg);const fg=mix(rgba(style.color),bg),a=lum(fg),b=lum(bg);return {text:e.textContent.slice(0,70),color:style.color,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
    });
    for(const sample of contrast)assert.ok(sample.ratio>=4.5,`${engineName}/${theme} text contrast ${JSON.stringify(sample)}`);
    const full=summary.getByRole('button',{name:'Full details',exact:true});await full.scrollIntoViewIfNeeded();
    if(output)await page.screenshot({path:path.join(output,`${engineName}-${theme}-${width}x${height}-${scenario}-summary.png`),fullPage:false});
    await full.click();
    const drawer=page.locator('.job-record-drawer');await drawer.waitFor({state:'visible'});
    assert.equal(await summary.count(),0,'Explicit Full details replaces summary');
    assert.match(await drawer.innerText(),/JKSYNTHETIC/);
    await drawer.evaluate(e=>{e.getBoundingClientRect();for(const animation of e.getAnimations({subtree:true}))animation.finish();});
    const drawerLayout=await drawer.evaluate(e=>{const box=selector=>{const n=e.querySelector(selector),r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,client:n.clientWidth,scroll:n.scrollWidth};};return {header:box('.record-drawer-header'),body:box('.record-drawer-body'),footer:box('.record-drawer-actions'),width:innerWidth,height:innerHeight};});
    for(const area of [drawerLayout.header,drawerLayout.body,drawerLayout.footer]){assert.ok(area.left>=-1&&area.right<=width+1&&area.top>=-1&&area.bottom<=height+1,`Full details area stays in viewport ${JSON.stringify(drawerLayout)}`);assert.ok(area.scroll<=area.client+1,'Full details area has no horizontal overflow');}
    assert.ok(drawerLayout.header.bottom<=drawerLayout.body.top+1&&drawerLayout.body.bottom<=drawerLayout.footer.top+1,'Full details header/body/footer do not overlap');
    assert.ok(drawerLayout.body.height>0,'Full details keeps a scrollable body');
    if(output)await page.screenshot({path:path.join(output,`${engineName}-${theme}-${width}x${height}-${scenario}-full-details.png`),fullPage:false});

    const back=drawer.getByRole('button',{name:/Back to summary/i});await back.click();await summary.waitFor({state:'visible'});
    assert.equal(await drawer.count(),0,'Returning to summary unmounts full detail components');
    await page.keyboard.press('Escape');await summary.waitFor({state:'detached'});
    assert.equal(await card.evaluate(e=>e===document.activeElement||e.contains(document.activeElement)),true,'Dismissal returns focus to appointment trigger: '+await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,250)));
    await card.tap();await summary.waitFor({state:'visible'});
    await summary.getByRole('button',{name:/^Close( appointment summary)?$/i}).first().click();await summary.waitFor({state:'detached'});
    await card.tap();await summary.waitFor({state:'visible'});await page.keyboard.press('Escape');await summary.waitFor({state:'detached'});
    const finalCalls=await calls();assert.deepEqual(finalCalls.filter(call=>call.method!=='GET'),[],'No operational request attempted during read-only QA');
    assert.deepEqual(network,[],'No API or external request escaped the in-memory fixture');assert.deepEqual(errors,[]);
    results.push({engineName,width,height,theme,scenario,layout,drawerLayout,contrast,keyboardFocus,summaryCalls,readPaths:[...new Set(finalCalls.map(call=>call.path))]});
    await page.close();
   }
   for(const width of [390,1280])for(const view of ['history','followup']){
    const page=await browser.newPage({viewport:{width,height:900},hasTouch:true,reducedMotion:'reduce'});
    const errors=[],network=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'||url.pathname.startsWith('/api/')){network.push(url.pathname);return route.abort();}return route.continue();});
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/appointment-summary.html?case=long&view=${view}`,{waitUntil:'networkidle'});
    const trigger=page.getByRole('button',{name:view==='history'?'Open':'Open and Review',exact:true});
    await trigger.click();
    await page.locator(width<=900?'.appointment-summary-dialog':'.job-record-drawer').waitFor({state:'visible'});
    assert.equal(await page.locator(width<=900?'.job-record-drawer':'.appointment-summary-dialog').count(),0,`${view} preserves breakpoint-specific opening`);
    const opened=page.locator(width<=900?'.appointment-summary-dialog':'.job-record-drawer');
    await opened.evaluate(e=>{e.getBoundingClientRect();for(const animation of e.getAnimations({subtree:true}))animation.finish();});
    const openedBox=await opened.boundingBox();assert.ok(openedBox&&openedBox.x>=0&&openedBox.x+openedBox.width<=width+1,'Opened record panel is visible inside viewport');
    if(output)await page.screenshot({path:path.join(output,`${engineName}-${width}-${view}.png`)});
    await page.keyboard.press('Escape');
    await page.locator('.appointment-summary-dialog,.job-record-drawer').waitFor({state:'detached'});
    assert.ok(await trigger.evaluate(e=>e===document.activeElement),'Closing restores the selected record control');
    assert.deepEqual(await page.evaluate(()=>window.summaryFixtureCalls.filter(call=>call.method!=='GET')),[]);
    assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
    results.push({engineName,width,scenario:view,opening:width<=900?'summary':'drawer'});await page.close();
   }
   const linked=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'});
   const linkedNetwork=[];await linked.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'||url.pathname.startsWith('/api/')){linkedNetwork.push(url.pathname);return route.abort();}return route.continue();});
   await linked.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/appointment-summary.html?case=long&date=2026-10-25&appointment=999001&focus=record`,{waitUntil:'networkidle'});
   await linked.locator('.appointment-summary-dialog').waitFor({state:'visible'});
   assert.equal(await linked.locator('.job-record-drawer').count(),0,'Phone deep link opens summary first');
   assert.match(await linked.locator('.appointment-summary-dialog').innerText(),/JKSYNTHETIC/);
   const linkedCalls=await linked.evaluate(()=>window.summaryFixtureCalls);
   assert.ok(linkedCalls.every(call=>{const query=new URLSearchParams(call.search);return call.method==='GET'&&!/closeout|history|customer|prepare|operations/.test(call.path)&&(call.path!=='/api/desktop/schedule/cost'||query.get('scope')==='attendance')&&(call.path!=='/api/desktop/schedule/routes'||!query.has('appointment'));}),`Phone deep link cannot prepare operational details: ${JSON.stringify(linkedCalls)}`);
   await linked.keyboard.press('Escape');await linked.locator('.appointment-summary-dialog').waitFor({state:'detached'});
   for(const key of ['appointment','q','focus'])assert.equal(new URL(linked.url()).searchParams.has(key),false,'Summary close clears record link intent');
   await linked.reload({waitUntil:'networkidle'});assert.equal(await linked.locator('.appointment-summary-dialog,.job-record-drawer').count(),0,'Reload after dismissal does not reopen record');
   const linkedCard=linked.locator('[data-schedule-appointment]:visible').first();await linkedCard.tap();await linked.locator('.appointment-summary-dialog').waitFor({state:'visible'});
   await linked.evaluate(()=>window.summaryFixtureRefresh(false));await linked.locator('.appointment-summary-dialog').waitFor({state:'detached'});
   await linked.evaluate(()=>window.summaryFixtureRefresh(true));await linkedCard.waitFor({state:'visible'});
   assert.equal(await linked.locator('.appointment-summary-dialog').count(),0,'Returning source record must not reopen a dismissed summary');
   assert.deepEqual(linkedNetwork,[]);results.push({engineName,scenario:'phone-deep-link',readCalls:linkedCalls});await linked.close();
  }finally{await browser.close();}
 }
 if(output)fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
 console.log(`Appointment summary: ${results.length} Chromium/WebKit responsive cases pass; tap → read-only summary → explicit full details → back/close/Escape, focus/repeat, long/missing/warning values, bounded layout, no operational or external requests.`);
}finally{await server.close();fs.rmSync(cache,{recursive:true,force:true});}
