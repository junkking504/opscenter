import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=process.env.ALERT_QA_URL||'http://127.0.0.1:3166';
const output=process.env.ALERT_QA_OUTPUT||'/tmp/contextual-alert-qa';fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());
const mapUrl=(mode='fresh',date=day)=>`${base}/desktop?workspace=Schedule&scheduleView=board&date=${date}&truck=Truck+9&focus=truck&case=${mode}`;
for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:852}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:204}));
 await page.goto(base+'/desktop?workspace=Command&case=fresh');
 const row=page.locator('[data-alert-id="geo"] summary');await row.click();
 const dialog=page.locator('dialog[open]');await dialog.waitFor();
 assert.match(await dialog.innerText(),/Exact arrival time is unavailable/);
 let box=await dialog.boundingBox();assert.ok(box.y>=0&&(width>720||box.y<60)&&box.y+Math.min(box.height,400)<852,'Alert details visible immediately');
 await page.getByRole('button',{name:'Close alert details'}).click();assert.equal(await dialog.count(),0);
 await row.focus();await page.keyboard.press('Enter');await dialog.waitFor();
 await dialog.getByRole('link',{name:'Truck 9 departed NOHQ'}).click();
 await page.locator('[data-alert-ready="truck"]').waitFor();
 await page.waitForFunction(()=>window.qaMap&&window.qaMap.getCenter().distanceTo([30.09,-90.09])<1);
 await page.waitForTimeout(150);
 const bounds=await page.evaluate(()=>{const s=document.querySelector('.alert-map-summary').getBoundingClientRect(),m=document.querySelector('.alert-map-focus .schedule-map-canvas').getBoundingClientRect();const h=document.querySelector('.live-mobile-navigation').getBoundingClientRect();return {header:h.height?h.bottom:0,top:s.top,bottom:m.bottom,overflow:document.documentElement.scrollWidth>innerWidth,selected:document.querySelector('.truck-marker.route-selected')?.getAttribute('aria-label'),zoom:window.qaMap.getZoom()};});
 assert.ok(bounds.top>=bounds.header&&bounds.bottom<=852,JSON.stringify(bounds));assert.equal(bounds.overflow,false);assert.match(bounds.selected,/Truck# 9,/);assert.equal(bounds.zoom,19);
 await page.screenshot({path:`${output}/truck-${width}.png`});
 await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));const manual=await page.evaluate(()=>scrollY);
 await page.waitForTimeout(2300);assert.equal(await page.evaluate(()=>scrollY),manual,'No repeated scroll on later DOM updates');
 await page.goBack();await row.waitFor();await row.click();await dialog.getByRole('link',{name:'Truck 9 departed NOHQ'}).click();await page.locator('[data-alert-ready="truck"]').waitFor();
 await page.goBack();await row.waitFor();await page.goForward();await page.locator('[data-alert-ready="truck"]').waitFor();
 for(const mode of ['delay','stale','missing','no-gps']){
  await page.goto(mapUrl(mode));await page.locator('[data-alert-ready="truck"]').waitFor();await page.waitForTimeout(150);
  const summary=await page.locator('.alert-map-summary').innerText();
  if(mode==='stale')assert.match(summary,/stale|offline/i);
  if(mode==='missing')assert.match(summary,/no unique GPS record/);
  if(mode==='no-gps')assert.match(summary,/Position unavailable/);
  const y=(await page.locator('.alert-map-summary').boundingBox()).y;assert.ok(y>=0&&y<160,`${mode}: ${y}`);
 }
 await page.goto(mapUrl('fresh','2020-01-01'));await page.locator('[data-alert-ready="truck"]').waitFor();assert.match(await page.locator('.alert-map-summary').innerText(),/Historical day/);assert.equal(await page.locator('.truck-marker').count(),0,'Historical source never claims current GPS');
 await page.goto(base+'/desktop?workspace=Command&case=fresh');await page.locator('[data-alert-id="appointment"] summary').click();assert.match(await dialog.innerText(),/Synthetic follow-up warning/);assert.match(await dialog.innerText(),/Use the side entrance/);await dialog.locator('h2 a').click();await page.locator('.record-drawer').waitFor();assert.match(await page.locator('.record-drawer').innerText(),/JK1000001/);
 await page.goto(`${base}/desktop?workspace=Schedule&date=${day}&appointment=999&focus=record&case=missing-job`);await page.locator('.schedule-link-notice').waitFor();assert.match(await page.locator('.schedule-link-notice').innerText(),/not|unavailable|found/i);
 await page.goto(base+'/desktop?workspace=Command&case=fresh');await page.locator('[data-alert-id="unknown"] summary').click();assert.equal(await dialog.locator('h2 a').count(),0);assert.match(await dialog.innerText(),/Current coverage is unknown/);await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
 await page.goto(base+'/desktop?workspace=Command&notification='+'a'.repeat(64));await dialog.getByRole('link',{name:'Truck #9'}).waitFor();assert.match(await dialog.innerText(),/Synthetic notification/);
 await page.goto(mapUrl('delay'));await page.locator('.live-schedule').waitFor();await page.evaluate(()=>window.dispatchEvent(new WheelEvent('wheel',{deltaY:100})));const position=await page.evaluate(()=>scrollY);await page.locator('[data-alert-ready="truck"]').waitFor();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>scrollY),position,'User movement cancels delayed reveal');
 await page.goto(base+'/desktop?workspace=Command&case=delay&notification='+'a'.repeat(64));await dialog.waitFor();await page.getByRole('button',{name:'Close alert details'}).click();await page.waitForTimeout(1500);assert.equal(await dialog.count(),0,'Dismissed delayed notification cannot reopen');
 assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${width}px: two-step details/headline, keyboard/dismiss, exact GPS focus, visible summary/map, repeat/back/forward, delayed/stale/missing/historical, appointment and native receipt.`);
}
await browser.close();
