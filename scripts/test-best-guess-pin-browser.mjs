import {openScheduleControls,closeScheduleControls} from './schedule-controls-browser.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Run against the real-map fixture (tests/area-colors.vite.config.ts).
const browser=await chromium.launch({headless:true});
const streetPin=process.env.PIN_KIND==='street';
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>['127.0.0.1','tile.openstreetmap.org'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await page.goto(`${process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3186'}/tests/schedule-destinations.html?scenario=map-fallback&details=long${streetPin?'&pin=street':''}`);
  await openScheduleControls(page);
  await page.getByRole('button',{name:/^2026-09-07/}).click();
  await closeScheduleControls(page);
  const pin=page.getByRole('button',{name:/Open appointment JK1001, approximate location/});
  await pin.click();
  const summary=page.getByRole('region',{name:'Selected job JK1001',exact:true});
  await summary.getByText(/Approx\. 12 min/).waitFor();
  assert.match(await summary.innerText(),streetPin?/123 Example St/:/26-107/,'Keep the entered service address visible');
  await summary.getByText('Pin details',{exact:true}).click();
  assert.match(await summary.innerText(),streetPin?/Approximate street location; house number not located/:/Unit 26107/,'Show the chosen candidate and precision on demand');
  await summary.getByText('Pin details',{exact:true}).click();
  assert.equal(await summary.getByRole('link',{name:'Open pin',exact:true}).getAttribute('href'),`https://maps.apple.com/place?coordinate=${streetPin?'30.3178,-89.9477':'30.45,-90.05'}`);
  assert.doesNotMatch(await page.locator('body').innerText(),/Address needs confirmation|Address needs correction|Confirm the complete service address|Location pending/);
  assert.match(await page.getByRole('button',{name:/No pin/}).innerText(),/0/,'Approximate pins count as mapped');
  assert.equal(await page.locator('.selected-job-closest.needs-review').count(),0);
  assert.equal(await page.locator('.appointment-marker.approximate-location').count(),1);
  await page.waitForFunction(()=>{const marker=document.querySelector('.appointment-marker.approximate-location')?.getBoundingClientRect(),map=document.querySelector('.live-schedule-map')?.getBoundingClientRect();return marker&&map&&marker.left>=map.left&&marker.right<=map.right&&marker.top>=map.top&&marker.bottom<=map.bottom;});
  await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-tile')].every(tile=>tile.complete&&tile.naturalWidth>0));
  if(process.env.PIN_SCREENSHOT)await page.screenshot({path:process.env.PIN_SCREENSHOT,fullPage:true});
  await page.getByRole('button',{name:'Route Order',exact:true}).click();
  await page.getByRole('dialog',{name:'Truck Route Order'}).waitFor();
  assert.ok((await page.getByRole('dialog',{name:'Truck Route Order'}).innerText()).includes('Approximate'),'Route Order also retains the pin');
  assert.match(await page.locator('#fixture-writes').innerText(),/Writes: 0/);
  assert.deepEqual(errors,[]);
  console.log(`Best-guess ${streetPin?'street':'premises'} pin browser passed: real map marker, selection, address and source, direct pin link, approximate ETA, map coverage, Route Order, and no confirmation prompt or writes.`);
} finally {await browser.close();}
