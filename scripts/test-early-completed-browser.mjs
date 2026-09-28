import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';

const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3167';
for (const engine of [chromium,webkit]) {
  const browser=await engine.launch({headless:true});
  try {
    for (const width of [1312,390]) {
      const page=await browser.newPage({viewport:{width,height:820}});
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`${base}/tests/schedule-destinations.html?scenario=early-completed`);
      const block=page.locator('[data-schedule-appointment][data-time-basis="actual"]');
      await block.waitFor();
      assert.match(await block.getAttribute('aria-label'),/10:23 AM.*10:46 AM/);
      assert.equal(await page.locator('[data-schedule-appointment][data-time-basis="booked"]').count(),0);
      await block.click();
      const summary=page.getByRole('region',{name:'Selected job JK1001001',exact:true});
      assert.match(await summary.innerText(),/Started 10:23 AM · Finished 10:46 AM/);
      assert.match(await summary.innerText(),/3:00 PM–4:00 PM/,'Original booking remains available');
      await page.getByRole('button',{name:'Select Truck# 8 on map',exact:true}).click();
      const trips=page.locator('.schedule-trip-list button');
      await trips.first().waitFor();
      assert.equal(await trips.count(),2);
      assert.match(await trips.nth(0).innerText(),/Example appointment 1.*9:00 AM – 10:23 AM/s);
      assert.match(await trips.nth(1).innerText(),/Example appointment 1.*10:46 AM – 12:00 PM/s);
      await trips.nth(1).click();
      assert.equal(await trips.nth(1).getAttribute('aria-pressed'),'true');
      assert.ok(await trips.evaluateAll(elements=>elements.every(el=>el.getBoundingClientRect().right<=innerWidth)),'Trip list fits the viewport');
      assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
      assert.deepEqual(errors,[]);
      if (process.env.SCHEDULE_SCREENSHOT_DIR && width===1312) {
        await page.locator('.schedule-map-controls').screenshot({path:`${process.env.SCHEDULE_SCREENSHOT_DIR}/appointment-trips-${engine.name()}-panel.png`});
      }
      await page.close();
      console.log(`${engine.name()} ${width}: early actual block, original booking, inbound/outbound legs, selection and zero writes passed.`);
    }
  } finally { await browser.close(); }
}
