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
    assert.equal(await gap.locator('span').evaluate(element=>getComputedStyle(element).fontSize),'11px');
    const standaloneDump=page.locator('[data-operational-stop="dump"]');
    assert.equal(await standaloneDump.count(),1,'The dump inside the appointment gap is not duplicated; the later between-customer dump remains');
    assert.equal(await standaloneDump.getAttribute('data-operational-icon'),'dump');
    assert.equal(await standaloneDump.getAttribute('aria-label'),'Dump · 11:15 AM–11:30 AM');
    assert.equal(await standaloneDump.getAttribute('title'),'Dump · 11:15 AM–11:30 AM');
    assert.equal(await standaloneDump.locator('svg').count(),1);
    assert.equal(await standaloneDump.evaluate(element=>element.getBoundingClientRect().height),22);
    const hqDeparture=page.locator('[data-operational-stop="departure"]');
    assert.equal(await hqDeparture.getAttribute('data-operational-icon'),'house');
    assert.equal(await hqDeparture.getAttribute('aria-label'),'Left NOHQ · 8:30 AM');
    assert.equal(await hqDeparture.getAttribute('title'),'Left NOHQ · 8:30 AM');
    const emr=page.locator('[data-operational-icon="steel-beam"]');
    assert.equal(await emr.count(),1,'EMR is represented by one steel-beam icon');
    assert.equal(await emr.getAttribute('aria-label'),'EMR · 12:00 PM–12:10 PM');
    assert.equal(await emr.getAttribute('title'),'EMR · 12:00 PM–12:10 PM');
    assert.equal(await emr.locator('svg').count(),1);
    assert.equal(await emr.evaluate(element=>element.getBoundingClientRect().height),22);
    const operationalRow=page.locator('[data-schedule-truck="Truck 8"]');
    assert.equal(await operationalRow.getAttribute('data-operational-lanes'),width===390?'2':'1','Facility pills stack only when the available timeline width would make them collide');
    assert.equal(await operationalRow.locator('.schedule-timeline-content').evaluate(element=>getComputedStyle(element).zoom),'1','Rows with facility labels preserve readable text instead of shrinking to fit');
    assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  }
  console.log('Schedule visit gap passed: connected return blocks, compact dump/HQ/EMR icons, responsive layout and zero writes.');
} finally { await browser.close(); }
