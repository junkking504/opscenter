import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 for(const viewport of [{width:1813,height:961},{width:1440,height:810}]) {
  await page.setViewportSize(viewport);
  await page.goto(`${base}/tests/schedule-destinations.html?scenario=crowded&details=long`);
  const cards=page.locator('[data-schedule-truck="Truck 9"] [data-schedule-appointment]');
  await cards.first().waitFor();
  for(const selected of [false,true]) {
   if(selected) await cards.first().click();
   await page.waitForFunction(()=>{const scroller=document.querySelector('.schedule-board-scroll');const last=document.querySelector('[data-schedule-truck="Unassigned"]');return scroller&&last&&last.getBoundingClientRect().bottom<=scroller.getBoundingClientRect().bottom+1;});
   const geometry=await page.locator('.schedule-board-scroll').evaluate(element=>({client:element.clientHeight,scroll:element.scrollHeight,width:element.clientWidth,scrollWidth:element.scrollWidth,bottom:element.getBoundingClientRect().bottom,rows:[...element.querySelectorAll('[data-schedule-truck]')].map(row=>row.getBoundingClientRect().toJSON())}));
   assert.equal(geometry.rows.length,10);
   assert.ok(geometry.scroll<=geometry.client+1,'All truck rows fit without internal scrolling');
   assert.ok(geometry.scrollWidth<=geometry.width+1,'The hourly ruler fits horizontally');
   assert.ok(geometry.bottom<viewport.height,'The complete board remains on screen');
   const map=await page.locator('.schedule-map-panel').boundingBox();
   assert.ok(map && map.width>=300,'Map retains a useful width with or without selected details');
   if(selected){const details=await page.locator('.schedule-selected-job-pane').boundingBox();assert.ok(details && details.y<geometry.rows[0].top,'Selection details stay beside the board');}
  }
 }
 assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
 console.log('Screen fit passed: ten truck rows, selected and unselected, desktop and laptop viewport, no board scrolling, zero writes.');
} finally {await browser.close();}
