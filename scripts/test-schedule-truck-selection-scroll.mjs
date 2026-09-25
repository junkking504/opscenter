import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });

try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto('http://127.0.0.1:3156/tests/schedule-destinations.html?scenario=truck-scroll&loads=1');

    const trucks = page.locator('.schedule-truck-cell');
    await trucks.nth(2).waitFor();
    assert.equal(
      await page.locator('.schedule-dispatch-surface').evaluate((element) => getComputedStyle(element).overflowAnchor),
      'none',
      'The changing map and truck details must be excluded from browser scroll anchoring',
    );
    await page.evaluate(() => {
      const target = document.querySelectorAll('.schedule-truck-cell')[2];
      if (target) window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - 300);
    });
    const before = await page.evaluate(() => window.scrollY);

    await trucks.nth(2).click();
    await page.locator('.live-map-truck-card[aria-label="Truck# 3 details"]').waitFor();
    await page.waitForTimeout(100);

    const afterFirst = await page.evaluate(() => window.scrollY);
    assert.equal(afterFirst, before, `Selecting a schedule truck must not move the page at ${width}px`);

    await trucks.nth(3).click();
    await page.locator('.live-map-truck-card[aria-label="Truck# 4 details"]').waitFor();
    await page.waitForTimeout(100);

    const afterSecond = await page.evaluate(() => window.scrollY);
    assert.equal(afterSecond, afterFirst, `Switching to a differently sized truck card must not move the page at ${width}px`);
    assert.equal(await trucks.nth(3).getAttribute('aria-pressed'), 'true', 'Truck selection still updates the schedule and map');
    await page.close();
  }

  console.log('Schedule truck selection stays at the current page position on desktop and mobile.');
} finally {
  await browser.close();
}
