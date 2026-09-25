import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });

try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto('http://127.0.0.1:3156/tests/schedule-destinations.html?scenario=same-time&loads=1');

    const truck = page.locator('.schedule-truck-cell').first();
    await truck.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => window.scrollY);

    await truck.click();
    await page.locator('.live-map-truck-card').waitFor();
    await page.waitForTimeout(100);

    const after = await page.evaluate(() => window.scrollY);
    assert.equal(after, before, `Selecting a schedule truck must not move the page at ${width}px`);
    assert.equal(await truck.getAttribute('aria-pressed'), 'true', 'Truck selection still updates the schedule and map');
    await page.close();
  }

  console.log('Schedule truck selection stays at the current page position on desktop and mobile.');
} finally {
  await browser.close();
}
