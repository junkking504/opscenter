import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
const origin = process.env.DESKTOP_TEST_ORIGIN || 'http://127.0.0.1:3158';
const evidence = process.env.HEADER_EVIDENCE || '/tmp/ui-header-buttons-evidence';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const workspace of ['Command', 'Schedule', 'Krewe', 'Fleet', 'Finance', 'Marketing']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(60000);
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(theme => localStorage.setItem('ops-theme', theme), theme);
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.fulfill({ status: 204 }));
    if (page.url() === 'about:blank') await page.goto(`${origin}/tests/aspect-ratio.html?workspace=${workspace}&commandMap=1`);
    await page.waitForSelector('.header-user');
    await page.evaluate(theme => window.OpsTheme.set(theme), theme);
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${workspace} ${width} ${theme}: page fits`);
    const live = page.locator('.header-live > button');
    await live.click();
    await page.getByRole('dialog', { name: 'Live status', exact: true }).waitFor();
    assert.ok(await page.getByText('Dashboard last updated', { exact: true }).isVisible());
    await page.getByRole('button', { name: /User menu:/ }).click();
    assert.equal(await page.getByRole('dialog', { name: 'Live status', exact: true }).count(), 0);
    await page.getByRole('dialog', { name: 'User settings', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.header-popover').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: /User menu:/ }).evaluate(el => el === document.activeElement), true);
    await live.click();
    await page.mouse.click(2, 500);
    await page.locator('.header-popover').waitFor({ state: 'hidden' });
    await live.click();
    await page.locator('.notification-trigger').click();
    await page.locator('.header-popover').waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    const button = page.locator('.header-user > button');
    assert.equal((await button.boundingBox()).height, width === 390 ? 44 : 32, 'shared control height');
    if (workspace === 'Schedule') {
      const newButton = page.getByRole('button', { name: 'New Appointment', exact: true });
      await newButton.waitFor();
      assert.match(await newButton.innerText(), /New/);
      for (const label of ['All', 'Open', 'Done', 'Attention']) assert.ok(await page.locator('.schedule-summary-button').filter({ hasText: label }).isVisible(), `${label} visible without Board Controls`);
      await page.getByLabel('Payment', { exact: true }).selectOption('paid');
      await page.getByLabel('Territory', { exact: true }).selectOption({ index: 1 });
      await page.getByRole('switch', { name: 'Show map', exact: true }).click();
      await page.getByRole('switch', { name: 'Show map', exact: true }).click();
    }
    await page.screenshot({ path: `${evidence}/${workspace}-${width}-${theme}.png`, fullPage: false, animations: 'disabled', timeout: 90000 });
    assert.deepEqual(errors, [], `${workspace}: browser errors`);
    console.log(`PASS ${workspace} ${width}x900 ${theme}: layout, shared sizing, disclosure exclusivity/dismissal`);
    page.removeAllListeners('pageerror');
    }
    await page.close();
  }
} finally { await browser.close(); }
console.log('Synthetic fixtures only; this is not the live app or physical handset acceptance.');
