import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(`${process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156'}/tests/schedule-destinations.html?scenario=route-stack`);
  const row=page.locator('[data-schedule-truck="Truck 9"]');
  const stacked=row.locator('.schedule-route-connector.vertical').first();
  await stacked.waitFor();
  const tooltip=stacked.locator('.route-connector-tooltip');
  assert.equal(await tooltip.isVisible(),false);
  const hit=stacked.locator('.route-connector-hover-target');
  const hitBox=await hit.boundingBox();
  assert.ok(hitBox && hitBox.width>=14,'Stacked dashed line has a forgiving hover target');
  await hit.hover();
  await tooltip.waitFor({state:'visible'});
  assert.equal((await tooltip.innerText()).replace(/\s+/g,' ').trim(),'TRAVEL 29 min · 20.8 mi');
  const tooltipBox=await tooltip.boundingBox();
  assert.ok(tooltipBox && tooltipBox.width>=90 && tooltipBox.height>=20,'Travel tooltip is visibly larger than the connector line');
  await row.screenshot({path:'/tmp/schedule-route-hover.png'});
  assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  console.log('Route hover PASS: stacked dashed line exposes a wide target and visible travel time/distance tooltip with zero writes.');
} finally {
  await browser.close();
}
