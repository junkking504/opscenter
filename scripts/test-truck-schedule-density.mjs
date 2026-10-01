import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [width, height] of [[1525, 698], [1280, 720], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    for (const scenario of ['crowded', 'dense', 'return-visit', 'route-stack']) {
      await page.goto(`${base}/tests/schedule-destinations.html?scenario=${scenario}&loads=1&progress=1`);
      await page.locator('[data-schedule-truck]').first().waitFor();
      const audit = await page.locator('.schedule-board').evaluate(board => {
        const rows = [...board.querySelectorAll('[data-schedule-truck]')];
        const intersections = [];
        for (const row of rows) {
          const blocks = [...row.querySelectorAll('.schedule-appointment,.schedule-operational-stop')].map(element => element.getBoundingClientRect());
          for (let a = 0; a < blocks.length; a++) for (let b = a + 1; b < blocks.length; b++) {
            const x = Math.min(blocks[a].right, blocks[b].right) - Math.max(blocks[a].left, blocks[b].left);
            const y = Math.min(blocks[a].bottom, blocks[b].bottom) - Math.max(blocks[a].top, blocks[b].top);
            if (x > .5 && y > .5) intersections.push({ truck: row.getAttribute('data-schedule-truck'), x, y });
          }
        }
        const condensed = rows.filter(row => row.hasAttribute('data-condensed'));
        return {
          intersections,
          widthRatios: condensed.map(row => {
            const timeline = row.querySelector('.live-truck-timeline').getBoundingClientRect();
            const content = row.querySelector('.schedule-timeline-content').getBoundingClientRect();
            return content.width / timeline.width;
          }),
          exposedMicrocopy: condensed.flatMap(row => [...row.querySelectorAll('.schedule-visit-duration,.schedule-visit-gap > span,.schedule-operational-stop > span,.truck-progress-customer')]
            .filter(element => getComputedStyle(element).display !== 'none').map(element => element.className)),
          routeLabels: condensed.flatMap(row => [...row.querySelectorAll('.route-connector-label')].map(element => getComputedStyle(element).textIndent)),
        };
      });
      assert.deepEqual(audit.intersections, [], `${width}x${height} ${scenario}: rendered blocks do not collide`);
      assert.ok(audit.widthRatios.every(ratio => ratio > .99), `${width}x${height} ${scenario}: time blocks retain full horizontal scale`);
      assert.deepEqual(audit.exposedMicrocopy, [], `${width}x${height} ${scenario}: compressed microcopy is hidden`);
      assert.ok(audit.routeLabels.every(indent => parseFloat(indent) < -100), `${width}x${height} ${scenario}: route details use a clean dot instead of overlapping inline text`);
      assert.equal(await page.locator('#fixture-writes').innerText(), 'Writes: 0');
    }
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${base}/tests/schedule-destinations.html?scenario=return-visit&loads=1&progress=1`);
  const shared = await page.locator('[data-schedule-truck="Truck 8"]').evaluate(row => {
    const appointmentTop = row.querySelector('.schedule-appointment')?.style.top;
    return [...row.querySelectorAll('.schedule-operational-stop')].filter(stop => stop.style.top === appointmentTop).length;
  });
  assert.ok(shared >= 2, 'Non-colliding HQ and facility visits share the appointment line');
  console.log('Truck schedule density passed: full-width time geometry, collision-free shared lanes, compact cues, and zero writes.');
} finally {
  await browser.close();
}
