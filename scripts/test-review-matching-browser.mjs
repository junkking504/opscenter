import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
// Start desktop-ui/tests/campaign.vite.config.ts first. Fixture intercepts every
// fetch and rejects non-marketing requests; this test never touches live data.
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto('http://127.0.0.1:3176/tests/campaign.html');
    await page.getByRole('tab', { name: 'Reviews', exact: true }).click();
    const detail = page.getByRole('region', { name: 'Review detail' });
    await detail.getByText('Auto-matched', { exact: true }).waitFor();
    assert.match(await detail.innerText(), /High confidence · 90 points/);
    assert.match(await detail.innerText(), /Reviewer name overlaps customer email handle/);
    await detail.getByRole('button', { name: 'Undo auto-match' }).click();
    await detail.getByText('No completed appointment has been confirmed for this review.').waitFor();
    assert.equal(await page.locator('#fixture-posts').innerText(), 'Mock saves: 1');
    await detail.getByRole('button', { name: 'Confirm JK1001', exact: true }).click();
    await detail.getByText('Matched job', { exact: true }).waitFor();
    assert.equal(await detail.getByText('Auto-matched', { exact: true }).count(), 0);
    assert.equal(await page.locator('#fixture-posts').innerText(), 'Mock saves: 2');
    // A fresh fixture proves an uncertain undo is resolved through its receipt
    // with one POST; the retry control never performs another assignment write.
    await page.reload();
    await page.getByRole('tab', { name: 'Reviews', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Simulate uncertain save' }).check();
    await detail.getByRole('button', { name: 'Undo auto-match' }).click();
    await page.getByText('Mock save result is uncertain.', { exact: true }).waitFor();
    assert.equal(await detail.getByRole('button', { name: 'Undo auto-match' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Check saved result', exact: true }).click();
    await detail.getByText('No completed appointment has been confirmed for this review.').waitFor();
    assert.equal(await page.locator('#fixture-posts').innerText(), 'Mock saves: 1');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: /Sample Reviewer 1 .*Market South/ }).first().click();
    assert.ok(await detail.getByRole('button', { name: 'Confirm JK1001', exact: true }).isVisible());
    if (process.env.REVIEW_MATCH_SCREENSHOT_DIR) {
      await page.screenshot({ path: `${process.env.REVIEW_MATCH_SCREENSHOT_DIR}/${name}-review-mobile.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.reload();
      await page.getByRole('tab', { name: 'Reviews', exact: true }).click();
      await detail.getByText('Auto-matched', { exact: true }).waitFor();
      await page.screenshot({ path: `${process.env.REVIEW_MATCH_SCREENSHOT_DIR}/${name}-review-auto.png`, fullPage: true });
    }
    console.log(`PASS ${name}: Auto-matched reasons, one-click undo/confirm, uncertain receipt recovery, mobile.`);
  } finally { await browser.close(); }
}
