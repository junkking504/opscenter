import assert from 'node:assert/strict';
import {chromium, webkit} from 'playwright';

const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
for (const engine of [chromium, webkit]) {
  const browser=await engine.launch({headless:true});
  try {
    const page=await browser.newPage();
    for (const [width,height] of [[1525,698],[1280,720],[1024,768],[390,844],[320,844]]) {
      await page.setViewportSize({width,height});
      for (const [scenario,count] of [['crowded',14],['dense',24],['route-stack',3]]) {
        await page.goto(`${base}/tests/schedule-destinations.html?scenario=${scenario}&loads=1&progress=1`);
        await page.locator('[data-schedule-appointment]').first().waitFor();
        await page.waitForFunction(count=>document.querySelectorAll('[data-schedule-appointment]').length===count,count);
        assert.ok(await page.locator('.live-map-territories button').evaluateAll(buttons=>buttons.every(el=>el.getBoundingClientRect().height>=38)),'Prominent map territory targets');
        assert.ok(await page.locator('.appointment-territory-toolbar button').evaluateAll(buttons=>buttons.every(el=>el.getBoundingClientRect().height>=38)),'Prominent register territory targets');
        assert.ok(await page.locator('.appointment-territory-heading').evaluateAll(headings=>headings.every(el=>el.getBoundingClientRect().height>=54)),'Distinct territory banners');
        for (const map of [true,false]) {
          if (!map) await page.getByRole('switch',{name:'Show map',exact:true}).click();
          const geometry=await page.locator('.schedule-board-shell').evaluate(shell=>{
            const box=shell.getBoundingClientRect();
            const scroll=shell.querySelector('.schedule-board-scroll');
            const clipped=[...shell.querySelectorAll('[data-schedule-appointment], [data-schedule-truck]')].filter(el=>{
              const r=el.getBoundingClientRect();
              return r.top<box.top-1 || r.bottom>box.bottom+1 || r.left<box.left-1 || r.right>box.right+1;
            }).map(el=>el.getAttribute('data-schedule-appointment') || el.getAttribute('data-schedule-truck'));
            return {clipped,innerOverflow:scroll.scrollHeight-scroll.clientHeight};
          });
          assert.deepEqual(geometry.clipped,[],`${engine.name()} ${width} ${scenario} map=${map}: every row and block fits its panel`);
          assert.ok(geometry.innerOverflow<=1,`No appointments hidden in an inner scrolling panel: ${JSON.stringify(geometry)}`);
          const last=page.locator('[data-schedule-appointment]').last();
          await last.click();
          await page.getByRole('region',{name:`Selected job JK100${1000+count}`,exact:true}).waitFor();
          // The list shortcut stays usable even after the board expands.
          await page.locator('.schedule-appointments-jump').click();
          await page.waitForFunction(()=>document.activeElement===document.querySelector('#schedule-all-appointments'));
          assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
        }
      }
      console.log(`${engine.name()} ${width}x${height}: all appointment rows contained and selectable; map on/off; zero writes`);
    }
  } finally { await browser.close(); }
}
