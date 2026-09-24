import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.CREW_ATTENTION_PREVIEW_URL || 'http://127.0.0.1:3128/tests/krewe-edits.html?mode=attention');
  await page.getByRole('button', { name: 'Today', exact: true }).click();

  const alert = page.getByRole('button', { name: 'Review issue for Sample Crew', exact: true });
  await alert.waitFor();
  assert.match(await alert.innerText(), /Needs attention[\s\S]*Pay pending:[\s\S]*Review issue/);
  assert.equal(await alert.locator('.crew-today-issue-copy > strong').evaluate(element => getComputedStyle(element).fontSize), '12px', 'Alert label stays on the surrounding text scale');
  assert.equal(await alert.evaluate(element => getComputedStyle(element).cursor), 'pointer');

  await alert.click();
  const dialog = page.getByRole('dialog', { name: 'Sample Crew', exact: true });
  await dialog.waitFor();
  await expectPressed(dialog.getByRole('button', { name: 'Pay details', exact: true }));
  assert.match(await dialog.locator('.krewe-record-issue').innerText(), /Needs attention[\s\S]*correction on 2026-09-04/);
  assert.match(await page.getByRole('status').filter({ hasText: 'Writes:' }).innerText(), /Writes: 0/, 'Opening an issue is read-only');

  await page.setViewportSize({ width: 320, height: 700 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Issue action and drawer must not overflow a phone viewport');
  assert.deepEqual(errors, []);
  console.log('Crew attention browser checks passed: proportional label, full-row action, matching pay issue detail, read-only navigation, and 320px width.');
} finally {
  await browser.close();
}

async function expectPressed(button) {
  assert.equal(await button.getAttribute('aria-pressed'), 'true', 'Issue opens the relevant record panel');
}
