import assert from 'node:assert/strict';
import {chromium, webkit} from 'playwright';

const origin = process.env.NOTIFICATION_PANEL_FIXTURE_URL || 'http://127.0.0.1:3148';
for (const browserType of [chromium, webkit]) {
  const browser = await browserType.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 760}});
    await page.goto(`${origin}/tests/notification-panel.html`);
    const panel = page.getByRole('dialog', {name: 'Alerts'});
    const list = panel.locator('.notification-list');
    const lastAlert = list.locator('.notification-alert').last();
    await panel.waitFor();

    assert.equal(await panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const point = document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 20);
      return Boolean(point && element.contains(point));
    }), true, `${browserType.name()}: alert panel must paint above the Schedule board`);

    const dimensions = await list.evaluate(element => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    assert.ok(dimensions.scrollHeight > dimensions.clientHeight, `${browserType.name()}: alert list must overflow in the constrained panel`);
    assert.equal(dimensions.overflowY, 'auto', `${browserType.name()}: alert list must own vertical scrolling`);

    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForFunction(element => element.scrollTop > 0, await list.elementHandle());
    assert.equal(await lastAlert.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const point = document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 8);
      return Boolean(point && element.contains(point));
    }), true, `${browserType.name()}: the final alert must be visible and interactive after scrolling`);
  } finally {
    await browser.close();
  }
}

console.log('Notification panel browser check passed in Chromium and WebKit: overlay stacking, internal overflow, and final-alert reachability.');
