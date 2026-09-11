import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  // Real rendering, synthetic appointments, and no external map/provider requests.
  await page.route('**/*', route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const colors=['#fbbf24','#fbbf24','#facc15','#facc15','#2dd4bf','#60a5fa','#fbbf24','#facc15'];
  for(const width of [1280,390]) {
    await page.setViewportSize({width,height:900});
    await page.goto('http://127.0.0.1:3156/tests/schedule-destinations.html?areas=1');
    await page.locator('[data-schedule-appointment]').first().waitFor();
    for(let index=0;index<colors.length;index++) {
      const jk=`JK100${1001+index}`;
      const block=page.locator(`[data-schedule-appointment][aria-label^="${jk} "]`);
      const marker=page.locator(`.appointment-marker[aria-label^="Open appointment ${jk},"]`);
      await marker.waitFor();
      for(const element of [block,marker]) assert.equal((await element.evaluate(e=>getComputedStyle(e).getPropertyValue('--territory-color'))).trim(),colors[index]);
      await block.click();
      const summary=page.getByRole('region',{name:`Selected job ${jk}`,exact:true});
      assert.equal((await summary.evaluate(e=>getComputedStyle(e).getPropertyValue('--territory-color'))).trim(),colors[index]);
      assert.equal(await summary.locator('.selected-job-area').innerText(),[0,1,6].includes(index)?'Westbank':[2,3,7].includes(index)?'East Metro':index===4?'Metairie':'New Orleans');
      assert.equal(await marker.getAttribute('aria-pressed'),'true');
      await summary.getByRole('button',{name:'Clear appointment selection'}).click();
      await marker.click();
      await summary.waitFor();
      assert.equal((await block.evaluate(e=>getComputedStyle(e).getPropertyValue('--territory-color'))).trim(),colors[index],'Selection preserves area color');
      await summary.getByRole('button',{name:'Clear appointment selection'}).click();
    }
    assert.equal(await page.locator('.appointment-marker.status-completed .map-pin-symbol').innerText(),'✓');
    assert.equal(await page.locator('.appointment-marker.status-canceled .map-pin-symbol').innerText(),'×');
    assert.match(await page.locator('#fixture-writes').innerText(),/Writes: 0/);
  }
  console.log('Schedule area colors passed at desktop/mobile widths: Westbank, postal aliases, East Metro, parish controls, board/map selection, status preservation and zero writes.');
} finally { await browser.close(); }
