import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [width, height] of [[1525, 698], [1280, 720], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    for (const scenario of ['crowded', 'dense', 'return-visit']) {
      await page.goto(`${base}/tests/schedule-destinations.html?scenario=${scenario}&loads=1&progress=1`);
      await page.locator('[data-schedule-truck]').first().waitFor();
      const fit = await page.locator('.schedule-board-shell').evaluate(shell => {
        const panel = shell.getBoundingClientRect();
        const scroll = shell.querySelector('.schedule-board-scroll');
        const rows = [...shell.querySelectorAll('[data-schedule-truck]')];
        return {
          first: rows.at(0)?.getBoundingClientRect().top,
          last: rows.at(-1)?.getBoundingClientRect().bottom,
          panelTop: panel.top,
          panelBottom: panel.bottom,
          hiddenPixels: scroll.scrollHeight - scroll.clientHeight,
          windowBottom: innerHeight,
          count: rows.length,
        };
      });
      assert.equal(fit.count, 10, 'All nine trucks and Unassigned are present');
      assert.ok(fit.first >= fit.panelTop - 1 && fit.last <= fit.panelBottom + 1, `${width}x${height} ${scenario}: all truck rows fit the panel: ${JSON.stringify(fit)}`);
      assert.ok(fit.panelBottom <= fit.windowBottom + 1, `${width}x${height} ${scenario}: schedule panel fits the screen`);
      assert.ok(fit.hiddenPixels <= 1, `${width}x${height} ${scenario}: schedule needs no inner scrolling`);
      assert.equal(await page.locator('#fixture-writes').innerText(), 'Writes: 0');
    }
  }
  console.log('Truck schedule fit passed: every truck row is visible without scrolling at supported desktop viewports; zero writes.');
} finally {
  await browser.close();
}
