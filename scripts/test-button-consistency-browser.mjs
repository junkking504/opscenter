import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
const browser = await chromium.launch({ headless: true });

const visualStyle = (locator) => locator.evaluate((element) => {
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  return {
    backgroundColor: style.backgroundColor,
    borderRadius: style.borderRadius,
    fontWeight: style.fontWeight,
    height: box.height,
  };
});

try {
  const page = await browser.newPage();
  for (const [width, height] of [[1440, 900], [390, 844], [320, 800]]) {
    await page.setViewportSize({ width, height });

    await page.goto(`${base}/tests/photo-review.html`);
    const review = page.getByRole('button', { name: 'Review WhatsApp photos', exact: true });
    await review.waitFor();
    const reviewStyle = await visualStyle(review);
    assert.deepEqual(reviewStyle, {
      backgroundColor: 'rgb(181, 25, 53)',
      borderRadius: '7px',
      fontWeight: '600',
      height: 36,
    });
    const reviewBox = await review.boundingBox();
    assert.ok(reviewBox.x >= 0 && reviewBox.x + reviewBox.width <= width + 1, `WhatsApp review action fits at ${width}px`);

    await page.goto(`${base}/tests/schedule-destinations.html?scenario=same-time&details=long&source=1`);
    const add = page.getByRole('button', { name: 'Add Appointment', exact: true });
    await add.waitFor();
    assert.deepEqual(await visualStyle(add), reviewStyle, `Add Appointment matches the shared action style at ${width}px`);
    const addBox = await add.boundingBox();
    assert.ok(addBox.x >= 0 && addBox.x + addBox.width <= width + 1, `Add Appointment fits at ${width}px`);

    await page.locator('[data-schedule-appointment]').first().click();
    await page.getByRole('button', { name: /Full details for/ }).click();
    const drawer = page.getByRole('dialog');
    await drawer.waitFor();
    const open = drawer.getByRole('button', { name: 'Open in JunkWare', exact: true });
    await open.waitFor();
    await open.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    assert.deepEqual(await visualStyle(open), reviewStyle, `Open in JunkWare matches the shared action style at ${width}px`);
    const openBox = await open.boundingBox();
    const drawerBox = await drawer.boundingBox();
    assert.ok(openBox.x >= drawerBox.x && openBox.x + openBox.width <= drawerBox.x + drawerBox.width + 1, `Open in JunkWare fits its drawer at ${width}px: ${JSON.stringify({ openBox, drawerBox })}`);
  }
  console.log('Button consistency PASS: WhatsApp review, Add Appointment, and Open in JunkWare share brand color, 36px action height, 7px radius, and 600 weight at 320–1440px.');
} finally {
  await browser.close();
}
