import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true});
const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
try {
  const page=await browser.newPage({viewport:{width:588,height:1100}});
  await page.goto(`${base}/tests/schedule-destinations.html?scenario=same-time&result=held`);
  const source=page.locator('[data-schedule-truck="Truck 8"] [data-schedule-appointment][aria-label^="JK1001001"]');
  const target=page.locator('[data-schedule-truck="Truck 6"] .live-truck-timeline');
  await source.waitFor();
  await target.scrollIntoViewIfNeeded();
  const from=await source.boundingBox(),to=await target.boundingBox();
  assert(from&&to,'Synthetic source and destination must be visible');
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);
  await page.mouse.down();
  await page.mouse.move(from.x+from.width/2,to.y+to.height/2,{steps:8});
  await page.mouse.up();

  assert.equal(await page.getByRole('dialog',{name:'Confirm schedule move',exact:true}).count(),0,'Drag/drop does not open a confirmation sheet');
  await page.getByText(/JunkWare verification is running in the background/).waitFor();
  await page.locator('[data-schedule-truck="Truck 6"] [data-schedule-appointment][aria-label^="JK1001001"]').waitFor();
  await page.waitForFunction(()=>document.querySelector('#fixture-writes')?.textContent?.startsWith('Writes: 1'));
  assert.equal(await page.locator('[data-schedule-truck="Truck 8"] [data-schedule-appointment][aria-label^="JK1001001"]').count(),0,'The appointment leaves its old lane immediately');

  await page.getByRole('button',{name:'Release Verified Receipt'}).click();
  await page.getByText(/move verified in JunkWare/i).waitFor();
  assert.match(await page.locator('#fixture-writes').innerText(),/^Writes: 1/,'Background verification never replays the move');
  console.log('Schedule move background browser PASS: mobile drag moves immediately, opens no confirmation, verifies in the background, and submits once.');
} finally {
  await browser.close();
}
