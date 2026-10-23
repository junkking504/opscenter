import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const preview = process.env.RPH_PREVIEW_URL || 'http://127.0.0.1:3197/desktop-assets/tests/rph.html';
const output = process.env.COMMAND_FOLD_SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'command-fold-'));
fs.mkdirSync(output, { recursive: true });
const rows = [];
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // The Vite base is /desktop-assets; production serves the wordmark at /.
    await page.route('**/opscenter-wordmark.png*', route => route.fulfill({ path: 'public/opscenter-wordmark.png', contentType: 'image/png' }));
    for (const [width, height] of [[320,800],[375,740],[390,740],[402,740],[430,740]]) {
      for (const mode of ['normal','large','zero','missing','stale']) {
        await page.setViewportSize({ width, height });
        await page.goto(`${preview}?layout=${mode}`);
        await page.getByRole('button', { name: 'Open AJS details', exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        const geometry = await page.evaluate(() => {
          const cards = [...document.querySelectorAll('.command-metrics .kpi-card')];
          const hero = document.querySelector('.command-revenue-hero');
          const rect = element => { const r = element.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; };
          return {
            bottom: document.querySelector('.command-metrics').getBoundingClientRect().bottom,
            pageWidth: document.documentElement.scrollWidth,
            cards: cards.map(e => ({ ...rect(e), text:e.innerText, fits:e.scrollWidth<=e.clientWidth+1 && e.scrollHeight<=e.clientHeight+1, sourceSize:parseFloat(getComputedStyle(e.querySelector('small')).fontSize), heading:[...e.querySelectorAll('.kpi-heading > span')].filter(c=>getComputedStyle(c).display!=='none').map(rect) })),
            hero: { ...rect(hero), fits:hero.scrollWidth<=hero.clientWidth+1 },
            revenue: rect(hero.querySelector('.hero-value')),
            goal: rect(hero.querySelector('.hero-pace > div')),
            controls: [...document.querySelectorAll('.viewing-day-controls button,.viewing-day-controls input,.brain-launch,.notification-trigger,.global-search,.live-mobile-navigation select')].map(rect),
          };
        });
        const context = `${name} ${width}x${height} ${mode}`;
        assert.equal(geometry.cards.length, 6, context);
        assert.ok(geometry.bottom <= height - 34, `${context}: KPI bottom ${geometry.bottom} exceeds usable fold ${height-34}`);
        assert.ok(geometry.pageWidth <= width && geometry.hero.fits, `${context}: horizontal page/hero overflow`);
        assert.ok(geometry.revenue.right <= geometry.goal.x + 1, `${context}: revenue overlaps daily goal`);
        for (const card of geometry.cards) {
          assert.ok(card.fits && card.x >= 0 && card.right <= width, `${context}: card overflow`);
          assert.ok(card.sourceSize >= 11, `${context}: source text shrunk`);
          assert.ok(card.text.includes('completed jobs') || card.text.includes('Source Oct 21'), `${context}: source/detail missing`);
          for (let i=1;i<card.heading.length;i++) assert.ok(card.heading[i-1].right <= card.heading[i].x + 1, `${context}: heading overlap`);
        }
        const [rph, ajs] = geometry.cards.slice(-2);
        assert.ok(Math.abs(rph.y-ajs.y)<1 && rph.right<ajs.x, `${context}: RPH/AJS adjacency`);
        for (const control of geometry.controls) assert.ok(control.width>=24 && control.height>=44 && control.x>=0 && control.right<=width+1, `${context}: header control hit target`);
        rows.push({ engine:name,width,height,mode,bottom:geometry.bottom,bottomReserve:height-geometry.bottom });
        if (width===402 && ['normal','large','zero'].includes(mode)) await page.screenshot({ path:`${output}/${name}-${width}-${mode}.png` });
      }
    }
    // Smaller available heights must remain scrollable, not clipped.
    for (const [width,height] of [[320,568],[375,600],[390,667],[740,390]]) {
      await page.setViewportSize({width,height}); await page.goto(`${preview}?layout=normal`);
      await page.locator('.command-metrics').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name}: short-window overflow`);
      await page.getByRole('button',{name:'Open AJS details',exact:true}).scrollIntoViewIfNeeded();
      assert.equal(await page.getByRole('button',{name:'Open AJS details',exact:true}).isVisible(),true);
    }
    await page.setViewportSize({width:402,height:740});
    for (const [label,workspace] of [['Revenue','Finance'],['Day’s jobs','Schedule'],['Labor','Krewe'],['Dump + Fuel','Finance'],['Net','Finance'],['RPH','Krewe'],['AJS','Finance']]) {
      await page.goto(`${preview}?layout=normal`); await page.locator('.command-metrics').waitFor();
      await (label==='Revenue' ? page.locator('.hero-value') : page.getByRole('button',{name:`Open ${label} details`,exact:true})).click();
      await page.waitForURL(url=>url.searchParams.get('workspace')===workspace);
      assert.equal(await page.getByLabel('Choose operating day',{exact:true}).inputValue(), '2026-10-13', `${name}: ${label} loses selected date`);
    }
    assert.deepEqual(errors, [], `${name}: runtime errors`);
  } finally { await browser.close(); }
}
fs.writeFileSync(`${output}/geometry.json`,JSON.stringify(rows,null,2));
console.log(`PASS: ${rows.length} Chromium/WebKit opening-screen cases, all seven KPI drilldowns, source text, badge/goal collisions, 34px bottom reserve, and shorter-window scrolling.`);
