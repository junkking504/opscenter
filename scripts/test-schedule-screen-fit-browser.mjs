import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 for(const viewport of [{width:1920,height:1080},{width:1813,height:961},{width:1440,height:810}]) {
  await page.setViewportSize(viewport);
  await page.goto(`${base}/tests/schedule-destinations.html?scenario=crowded&details=long`);
  const cards=page.locator('[data-schedule-truck="Truck 9"] [data-schedule-appointment]');
  await cards.first().waitFor();
  for(const selected of [false,true]) {
   if(selected) await cards.first().click();
   await page.waitForFunction(()=>document.querySelector('[data-schedule-truck="Unassigned"]')?.style.getPropertyValue('--schedule-row-height'));
   const geometry=await page.locator('.schedule-board-scroll').evaluate(element=>({client:element.clientHeight,scroll:element.scrollHeight,overflow:getComputedStyle(element).overflowY,width:element.clientWidth,scrollWidth:element.scrollWidth,bottom:element.getBoundingClientRect().bottom,rows:[...element.querySelectorAll('[data-schedule-truck]')].map(row=>row.getBoundingClientRect().toJSON())}));
   assert.equal(geometry.rows.length,10);
   if(geometry.scroll>geometry.client+1) assert.equal(geometry.overflow,'auto','Crowded schedules retain readable rows with scrolling');
   assert.ok(geometry.scrollWidth<=geometry.width+1,'The hourly ruler fits horizontally');
   assert.ok(geometry.bottom<viewport.height,'The complete board remains on screen');
   const map=await page.locator('.schedule-map-panel').boundingBox();
   const panel=await page.locator('.schedule-board-shell').boundingBox();
   assert.ok(map && map.width>=300,'Map retains a useful width with or without selected details');
   assert.ok(Math.abs(map.y-panel.y)<=1 && Math.abs(map.height-panel.height)<=1,'Map and schedule share their top and bottom edges');
   assert.ok(Math.abs(geometry.rows.at(-1).bottom-geometry.bottom-Math.max(0,geometry.scroll-geometry.client))<=2,'Truck rows fill the panel without a blank area below');
   if(selected){const details=await page.locator('.schedule-selected-job-pane').boundingBox();assert.ok(details && details.y<geometry.rows[0].top,'Selection details stay beside the board');}
  }
 }
 assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
 console.log('Screen fit passed: equal map/schedule heights, no blank area below rows, readable crowded overflow, selected and unselected, desktop and laptop, zero writes.');
} finally {await browser.close();}
