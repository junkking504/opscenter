import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(`${process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156'}/tests/schedule-destinations.html?scenario=stop-stack`);
  const row=page.locator('[data-schedule-truck="Truck 3"]');
  const first=row.locator('[data-schedule-appointment$=":appointment:1001"]');
  const second=row.locator('[data-schedule-appointment$=":appointment:1002"]');
  await first.waitFor();
  const [firstBox,secondBox]=await Promise.all([first.boundingBox(),second.boundingBox()]);
  assert.ok(firstBox && secondBox);
  assert.ok(firstBox.x>secondBox.x,'GPS evidence changes the first stop displayed start');
  assert.ok(firstBox.y<secondBox.y,'Saved first stop remains on top of the stack');
  assert.equal(await first.getAttribute('data-time-basis'),'actual');
  assert.equal(await second.getAttribute('data-time-basis'),'booked');
  assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  console.log('Stop Order stack browser PASS: saved first stop is above the second across GPS and planned timing, with zero writes.');
} finally {
  await browser.close();
}
