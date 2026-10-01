import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  for (const width of [1280,390]) {
    await page.setViewportSize({width,height:900});
    await page.goto(`${base}/tests/schedule-destinations.html?scenario=return-visit`);
    const gap=page.locator('[data-visit-gap="dump"]');
    await gap.waitFor();
    assert.equal(await gap.innerText(),'DUMP');
    assert.match(await gap.getAttribute('aria-label'),/left JK1001001 at 9:30 AM and returned at 10:30 AM\. Confirmed dump stop at Gentilly\./);
    const geometry=await gap.evaluate(element=>{
      const container=element.parentElement;
      const blocks=[...container.querySelectorAll('[data-schedule-appointment]')].map(element=>element.getBoundingClientRect()).sort((a,b)=>a.left-b.left);
      const gap=element.getBoundingClientRect();
      const style=getComputedStyle(element);
      return {blockCount:blocks.length,leftConnected:gap.left<=blocks[0].right+1,rightDelta:Math.abs(gap.right-blocks[1].left),background:style.backgroundImage,height:gap.height};
    });
    assert.equal(geometry.blockCount,2,'Return visit stays two measured site blocks');
    assert.ok(geometry.leftConnected && geometry.rightDelta<=1,`Striped connector fills the leave-and-return gap without a visual break: ${JSON.stringify(geometry)}`);
    assert.match(geometry.background,/repeating-linear-gradient/);
    assert.equal(geometry.height,22);
    const standaloneDump=page.locator('[data-operational-stop="dump"]');
    assert.equal(await standaloneDump.count(),1,'The dump inside the appointment gap is not duplicated; the later between-customer dump remains');
    assert.equal((await standaloneDump.innerText()).trim(),'DUMP');
    assert.match(await standaloneDump.getAttribute('aria-label'),/visited Gentilly · 11:15 AM–11:30 AM/);
    const hqDeparture=page.locator('[data-operational-stop="departure"]');
    assert.equal((await hqDeparture.innerText()).trim(),'LEFT NOHQ');
    assert.match(await hqDeparture.getAttribute('aria-label'),/departed NOHQ at 8:30 AM/);
    assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  }
  console.log('Schedule visit gap passed: connected return blocks, deduplicated and between-customer dumps, HQ departure, responsive layout and zero writes.');
} finally { await browser.close(); }
