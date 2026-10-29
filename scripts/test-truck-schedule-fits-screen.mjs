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
      for (const scenario of ['crowded', 'dense', 'fleet', 'return-visit']) {
        await page.goto(`${base}/tests/schedule-destinations.html?scenario=${scenario}&loads=1&progress=1&fullShell=1`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-schedule-appointment]').first().waitFor();
        await page.evaluate(() => {
          document.querySelectorAll('style, link[rel="stylesheet"]').forEach(element => element.remove());
          const main = document.querySelector('main');
          main.dataset.cssPhaseTwo = 'Schedule';
          main.classList.add('ops-app');

        });
        await page.addStyleTag({ content: css });
        for (const map of [true, false]) {
          if (!map) {
            if (width >= 1000) await page.getByRole('button', {name:'Board Controls',exact:true}).click();
            await page.getByRole('switch', { name: 'Show map', exact: true }).click();
            if (width >= 1000) await page.getByRole('button', {name:'Hide Controls',exact:true}).click();
          }
          // ResizeObserver and the next animation frame settle the fitted rows.
          await page.waitForTimeout(150);
          if (width < 1000) {
            await page.locator('.mobile-schedule-overview').waitFor();
            assert.equal(await page.locator('[data-schedule-truck]').count(), 0, 'Phone uses its unchanged overview');
            assert.ok(await page.locator('[data-schedule-appointment]').count() > 0);
            if (scenario === 'crowded') assert.ok(await page.locator('.truck-summary-card').first().evaluate(e => e.getBoundingClientRect().height > 70), 'Phone summary cards remain expanded');
            assert.equal(await page.locator('#fixture-writes').innerText(), 'Writes: 0');
            continue;
          }
          assert.ok(await page.getByRole('tablist',{name:'Command views'}).isVisible(),'Workspace navigation stays visible');
          if(width===1920 && scenario==='crowded' && map) {
            for(const view of ['Calendar','Customers','Estimates','Follow-Up','History']) {
              await page.getByRole('tab',{name:view,exact:true}).click();
              await page.getByRole('heading',{name:`${view} fixture view`}).waitFor();
              await page.getByRole('tab',{name:'Board',exact:true}).click();
              await page.locator('[data-schedule-appointment]').first().waitFor();
            }
            await page.getByRole('button',{name:'Board Controls',exact:true}).click();
            await page.getByRole('button',{name:'New',exact:true}).click();
            const booking=page.getByRole('dialog',{name:'New Appointment',exact:true});
            await booking.waitFor();
            await booking.getByRole('button',{name:'Close',exact:true}).first().click();
            assert.equal(await page.locator('.schedule-board-controls-trigger').getAttribute('aria-expanded'),'true','Closing the booking dialog preserves the controls panel');
            await page.getByRole('button',{name:'Krewe roster',exact:true}).click();
            await page.getByRole('dialog',{name:'Krewe roster',exact:true}).waitFor();
            await page.getByRole('button',{name:'Close krewe roster',exact:true}).click();
            await page.getByRole('button',{name:'Refresh Day',exact:true}).click();
            await page.locator('[data-schedule-appointment]').first().waitFor();
            await page.getByRole('textbox',{name:'Filter source appointments'}).fill('Example');
            await page.keyboard.press('Escape');
            const filteredToggle=page.getByRole('button',{name:'Board Controls · Filters active',exact:true});
            assert.ok(await filteredToggle.evaluate(e=>document.activeElement===e),'Escape restores focus and keeps the active-filter indicator');
            await filteredToggle.click();
            await page.getByRole('textbox',{name:'Filter source appointments'}).fill('');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(150);
          }
          if(width===1024 && scenario==='dense' && map && engine.name()==='chromium' && process.env.BOARD_DENSE_SCREENSHOT) await page.screenshot({path:process.env.BOARD_DENSE_SCREENSHOT});
          const fit = await page.locator('.schedule-board-shell').evaluate(shell => {
            const panel = shell.getBoundingClientRect();
            const scroll = shell.querySelector('.schedule-board-scroll');
            const rows = [...shell.querySelectorAll('[data-schedule-truck]')];
            const intersections = [];
            const naturalRows = rows.every(row => row.getBoundingClientRect().height >= Number(row.dataset.naturalHeight) - 1);
            const condensed = rows.some(row => row.hasAttribute('data-condensed'));
            const cards = [...document.querySelectorAll('.truck-summary-card')].map(card => ({ height: card.getBoundingClientRect().height, title: card.title, contextHidden: getComputedStyle(card.querySelector('.truck-summary-route')).position === 'absolute' }));
            for (const row of rows) {
              const blocks = [...row.querySelectorAll('.schedule-appointment,.schedule-operational-stop')].map(element => element.getBoundingClientRect());
              for (let a = 0; a < blocks.length; a++) for (let b = a + 1; b < blocks.length; b++) {
                if (Math.min(blocks[a].right, blocks[b].right) - Math.max(blocks[a].left, blocks[b].left) > .5 && Math.min(blocks[a].bottom, blocks[b].bottom) - Math.max(blocks[a].top, blocks[b].top) > .5) intersections.push(row.dataset.scheduleTruck);
              }
            }
            return {
              naturalRows, condensed, cards,
              coveredLabels: rows.filter(row=>{
                const label=row.querySelector('.schedule-truck-cell strong');
                const r=label.getBoundingClientRect();
                return !row.querySelector('.schedule-truck-cell').contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
              }).map(row=>row.dataset.scheduleTruck),
              outside: [...shell.querySelectorAll('[data-schedule-appointment],.schedule-truck-cell')].filter(element => {
                const r=element.getBoundingClientRect();
                return r.width<=0 || r.height<=0 || r.top<panel.top-.5 || r.bottom>Math.min(panel.bottom,innerHeight)+.5 || r.left<panel.left-.5 || r.right>panel.right+.5;
              }).map(element=>element.getAttribute('aria-label')),
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
          if(width === 1920 && scenario === 'crowded') assert.equal(fit.scale,1,'The reclaimed space keeps normal lane sizes at the owner viewport');
          if(width === 1920 && scenario === 'crowded' && map && engine.name() === 'chromium' && process.env.BOARD_SCREENSHOT) {
            await page.screenshot({path:process.env.BOARD_SCREENSHOT});
            await page.getByRole('button',{name:'Board Controls',exact:true}).click();
            assert.ok(await page.getByRole('textbox',{name:'Filter source appointments'}).isVisible());
            await page.getByRole('button',{name:'Hide Controls',exact:true}).click();
          }
          assert.equal(fit.count, 10, context);
          assert.deepEqual(fit.outside, [], context);
          assert.deepEqual(fit.coveredLabels, [], context);
          assert.deepEqual(fit.intersections, [], context);
          assert.equal(fit.blocks, { crowded: 14, dense: 24, fleet: 24, 'return-visit': 2 }[scenario], context);
          assert.ok(fit.scale > 0 && fit.scale <= 1, context);
          assert.ok(fit.hiddenPixels <= 1, context);
          assert.ok(fit.last <= fit.panelBottom + 1 && fit.panelBottom <= height, context);
          assert.ok(fit.jumpBottom <= height + 1, context);
          assert.ok(fit.cards.every(card => card.height <= 50 && card.contextHidden && card.title.includes('excludes tips') && card.title.includes('Crew:')), 'Desktop summary cards use two lines and retain supporting context');
          assert.equal(fit.overflow, 'hidden', context);
          const last = page.locator('[data-schedule-appointment]').last();
          await last.click();
          await page.locator('.schedule-selected-job-pane').waitFor();
          await page.waitForTimeout(150);
          const selectedFit=await page.locator('.schedule-board-shell').evaluate(shell=>{
            const panel=shell.getBoundingClientRect();
            return [...shell.querySelectorAll('[data-schedule-appointment],.schedule-truck-cell')].every(element=>{
              const r=element.getBoundingClientRect();
              return r.top>=panel.top-.5 && r.bottom<=Math.min(panel.bottom,innerHeight)+.5 && r.left>=panel.left-.5 && r.right<=panel.right+.5;
            }) && shell.querySelector('.schedule-board-scroll').scrollTop===0;
          });
          assert.ok(selectedFit,`Selected details retain the complete board: ${context}`);
          assert.equal(await page.locator('#fixture-writes').innerText(), 'Writes: 0');
          await page.keyboard.press('Escape');
          await page.evaluate(() => window.scrollTo(0, 0));
        }
      }
      console.log(`${engine.name()} ${width}x${height}: ${width<1000?'unchanged phone overview':'complete board without scrolling, compact cards, separate appointments and selection'}; map on/off passed`);
    }
  } finally { await browser.close(); }
}
