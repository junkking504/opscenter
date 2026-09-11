import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.clock.install({time:new Date('2026-09-07T13:26:00Z')});
  for (const [width,height] of [[1920,1080],[1440,900],[1280,768],[755,900],[390,900],[320,900]]) {
    await page.setViewportSize({width,height});
    await page.goto('http://127.0.0.1:3156/tests/schedule-destinations.html?scenario=same-time&loads=1');
    await page.locator('.day-switcher button').first().click();
    const jump=page.getByRole('button',{name:/All Appointments 4 View list below/});
    await jump.waitFor();
    const box=await jump.boundingBox();
    assert.ok(box.x>=0 && box.x+box.width<=width+1 && box.y>=0 && box.y+box.height<=height,`Banner in viewport ${width}: ${JSON.stringify(box)}`);
    const geometry=await page.evaluate(()=>{
      const rect=e=>e.getBoundingClientRect();
      const rows=[...document.querySelectorAll('.schedule-truck-row')];
      const empty=rows.filter(e=>!e.querySelector('[data-schedule-appointment]'));
      const header=rect(document.querySelector('.schedule-time-row'));
      const board=rect(document.querySelector('.schedule-board'));
      const lines=[...document.querySelectorAll('.schedule-now-line')];
      const line=rect(lines[0]);
      return {emptyHeights:empty.map(e=>rect(e).height),headerBottom:header.bottom,lineTop:line.top,lineBottom:rect(lines.at(-1)).bottom,lastBottom:rect(rows.at(-1)).bottom,boardBottom:board.bottom,
        aligned:rows.every(e=>Math.abs(rect(e.querySelector('.schedule-truck-cell')).right-rect(e.querySelector('.live-truck-timeline')).left)<1),
        contained:rows.every(e=>[...e.querySelectorAll('[data-schedule-appointment]')].every(b=>rect(b).top>=rect(e).top && rect(b).bottom<=rect(e).bottom+1))};
    });
    assert.ok(Math.max(...geometry.emptyHeights)-Math.min(...geometry.emptyHeights)<1,'Empty rows align regardless of load availability');
    assert.ok(geometry.aligned && geometry.contained,`Headers, timelines and blocks align: ${JSON.stringify(geometry)}`);
    assert.ok(Math.abs(geometry.lineTop-geometry.headerBottom)<1,'Time line starts below time header');
    assert.ok(Math.abs(geometry.lineBottom-geometry.lastBottom)<1,'Time line spans every row, including overflowing dense rows, without extending into blank space');
    if(width>=1000) assert.ok(Math.abs(geometry.lastBottom-geometry.boardBottom)<1 || geometry.lastBottom>geometry.boardBottom,'Rows use available panel height');
    if(width===1920||width===390)await page.screenshot({path:`/tmp/schedule-alignment-${width}.png`});
    await page.locator('[data-schedule-appointment]').first().click();
    await jump.click();
    await page.waitForFunction(()=>document.activeElement?.id==='schedule-all-appointments');
    const register=page.getByRole('region',{name:'All Appointments',exact:true});
    const heading=await register.getByRole('heading',{name:'All Appointments',exact:true}).boundingBox();
    assert.ok(heading.y>=0 && heading.y+heading.height<=height,`Jump brings register heading into view ${width}: ${JSON.stringify(heading)}`);
    assert.equal(await page.locator('.appointment-register-row').count(),4,'Jump clears selection filters and shows all appointments');
    assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  }
  console.log('Board alignment and All Appointments jump passed at 320–1920px.');
} finally { await browser.close(); }
