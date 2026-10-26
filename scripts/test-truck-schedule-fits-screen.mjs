import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, webkit } from 'playwright';

const base = process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
// Exercise the shipped stylesheet cascade, including the active Schedule theme.
const manifest = JSON.parse(fs.readFileSync('public/desktop-assets/.vite/manifest.json', 'utf8'));
const css = manifest['index.html'].css.map(file => fs.readFileSync(`public/desktop-assets/${file}`, 'utf8')).join('\n');
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [width, height] of [[1920, 990], [1784, 910], [1440, 900], [1280, 900], [1024, 600], [390, 844]]) {
      await page.setViewportSize({ width, height });
      for (const scenario of ['crowded', 'dense', 'return-visit']) {
        await page.goto(`${base}/tests/schedule-destinations.html?scenario=${scenario}&loads=1&progress=1`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-schedule-appointment]').first().waitFor();
        await page.evaluate(() => {
          document.querySelectorAll('style, link[rel="stylesheet"]').forEach(element => element.remove());
          const main = document.querySelector('main');
          main.dataset.cssPhaseTwo = 'Schedule';
          main.classList.add('ops-app');
          main.style.display = 'block';
          main.style.width = innerWidth >= 1000 ? 'calc(100% - 224px)' : '100%';
          main.style.marginLeft = innerWidth >= 1000 ? '224px' : '0';
        });
        await page.addStyleTag({ content: css });
        for (const map of [true, false]) {
          if (!map) await page.getByRole('switch', { name: 'Show map', exact: true }).click();
          // ResizeObserver and the next animation frame settle the fitted rows.
          await page.waitForTimeout(150);
          if (width < 1000) {
            await page.locator('.mobile-schedule-overview').waitFor();
            assert.equal(await page.locator('[data-schedule-truck]').count(), 0, 'Phone uses its unchanged overview');
            assert.ok(await page.locator('[data-schedule-appointment]').count() > 0);
            assert.equal(await page.locator('#fixture-writes').innerText(), 'Writes: 0');
            continue;
          }
          const fit = await page.locator('.schedule-board-shell').evaluate(shell => {
            const panel = shell.getBoundingClientRect();
            const scroll = shell.querySelector('.schedule-board-scroll');
            const rows = [...shell.querySelectorAll('[data-schedule-truck]')];
            const intersections = [];
            for (const row of rows) {
              const blocks = [...row.querySelectorAll('.schedule-appointment,.schedule-operational-stop')].map(element => element.getBoundingClientRect());
              for (let a = 0; a < blocks.length; a++) for (let b = a + 1; b < blocks.length; b++) {
                if (Math.min(blocks[a].right, blocks[b].right) - Math.max(blocks[a].left, blocks[b].left) > .5 && Math.min(blocks[a].bottom, blocks[b].bottom) - Math.max(blocks[a].top, blocks[b].top) > .5) intersections.push(row.dataset.scheduleTruck);
              }
            }
            return {
              last: rows.at(-1)?.getBoundingClientRect().bottom,
              panelBottom: panel.bottom,
              hiddenPixels: scroll.scrollHeight - scroll.clientHeight,
              overflow: getComputedStyle(scroll).overflowY,
              count: rows.length,
              intersections,
              scale: Number(rows[0].style.getPropertyValue('--schedule-timeline-scale')),
              blocks: [...shell.querySelectorAll('[data-schedule-appointment]')].length,
              jumpBottom: document.querySelector('.schedule-appointments-jump').getBoundingClientRect().bottom,
            };
          });
          const context = `${engine.name()} ${width}x${height} ${scenario} map=${map}: ${JSON.stringify(fit)}`;
          assert.equal(fit.count, 10, context);
          assert.deepEqual(fit.intersections, [], context);
          assert.equal(fit.blocks, { crowded: 14, dense: 24, 'return-visit': 2 }[scenario], context);
          if (width >= 1280) {
            assert.ok(fit.last <= fit.panelBottom + 1, context);
            assert.ok(fit.panelBottom <= height + 1, context);
            assert.ok(fit.hiddenPixels <= 1, context);
            assert.ok(fit.jumpBottom <= height + 1, context);
          } else if (width >= 1000 && fit.hiddenPixels > 1) {
            assert.equal(fit.overflow, 'auto', 'Very short windows retain a reachable fallback');
            assert.ok(fit.scale >= .3, 'Do not shrink lanes to invisibility');
          } else if (width < 1000) {
            assert.equal(fit.scale, 1, 'Phone lanes retain their existing size');
          }
          const last = page.locator('[data-schedule-appointment]').last();
          await last.click();
          await page.locator('.schedule-selected-job-pane').waitFor();
          assert.equal(await page.locator('#fixture-writes').innerText(), 'Writes: 0');
          await page.keyboard.press('Escape');
          await page.evaluate(() => window.scrollTo(0, 0));
        }
      }
      console.log(`${engine.name()} ${width}x${height}: compact rows, separate appointments, selection and map on/off passed`);
    }
  } finally { await browser.close(); }
}
