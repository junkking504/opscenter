import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 390]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme });
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:3176/tests/campaign.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.evaluate(theme => { document.documentElement.dataset.opsTheme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
    assert.equal(await page.locator('main').getAttribute('class'), 'ops-app ops-live');
    if (theme === 'dark') assert.equal(await page.locator('main').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(16, 25, 35)');
    const queue = page.getByRole('region', { name: 'Lead queue', exact: true });
    await queue.getByRole('button', { name: 'To Contact 12', exact: true }).waitFor();
    await queue.getByRole('button', { name: 'Booked 1', exact: true }).click();
    await queue.getByRole('button', { name: 'All 13', exact: true }).click();
    await queue.locator('.campaign-queue-row').first().click();
    const form = page.locator('.campaign-outcome');
    await form.getByRole('combobox', { name: /^Outcome/ }).waitFor();
    assert.deepEqual(await form.getByRole('combobox', { name: /^Outcome/ }).locator('option').allTextContents(), ['Booked', 'Contacted', 'Not Booked']);
    await form.getByRole('combobox', { name: /^Outcome/ }).selectOption('lost');
    await form.getByLabel('Note or next step').fill('Synthetic customer declined pricing.');
    await form.getByRole('button', { name: 'Review & save outcome' }).click();
    assert.equal(await page.getByRole('dialog').count(), 0, 'Not Booked requires a reason');
    await form.getByRole('combobox', { name: /^Reason/ }).selectOption('pricing');
    await form.getByRole('button', { name: 'Review & save outcome' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await page.locator('#fixture-posts').innerText(), 'Mock saves: 0');
    await dialog.getByRole('button', { name: 'Confirm & save', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByText('OpsCenter record saved and read back. External source data is unchanged.', { exact: true }).waitFor();
    assert.equal(await page.locator('#fixture-posts').innerText(), 'Mock saves: 1');
    for (const tab of ['Reviews', 'Results', 'Leads']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      if (tab === 'Reviews') {
        await page.getByRole('button', { name: 'Check These 1', exact: true }).click();
        await page.locator('.campaign-queue-row').first().click();
        await page.getByRole('region', { name: 'Review detail' }).getByText(/Weak · 90 points/).waitFor();
      }
      if (tab === 'Results') {
        await page.getByRole('heading', { name: 'Google Ads Spend by Account' }).waitFor();
        await page.getByText('Search Ads (All Markets)', { exact: true }).waitFor();
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${theme} ${tab} page overflow`);
    }
    if (process.env.MARKETING_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MARKETING_SCREENSHOT_DIR}/${width}-${theme}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px ${theme}: queues, reason validation, confirmation, verified receipt, tabs, no page overflow.`);
    await page.close();
  }
} finally { await browser.close(); }
