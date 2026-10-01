import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  // Real rendering, synthetic appointments, and no external map/provider requests.
  await page.route('**/*', route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const colors=['#fbbf24','#fbbf24','#facc15','#facc15','#2dd4bf','#60a5fa','#fbbf24','#facc15','#7c3aed','#7c3aed','#9ca3af','#9ca3af'];
  const areas=['Westbank','Westbank','East Metro','East Metro','Metairie','New Orleans','Westbank','East Metro','Ponchatoula / Bedico','Hammond','River Parishes','River Parishes'];
  for(const width of [1280,390]) {
    await page.setViewportSize({width,height:900});
    await page.goto('http://127.0.0.1:3156/tests/schedule-destinations.html?areas=1');
    await page.locator('[data-schedule-appointment]').first().waitFor();
    const assignedSymbol=page.locator('.appointment-marker.assignment-assigned[aria-label^="Open appointment JK1001001,"] .map-pin-symbol');
    const unassignedSymbol=page.locator('.appointment-marker.assignment-unassigned[aria-label^="Open appointment JK1001002,"] .map-pin-symbol');
    await assignedSymbol.waitFor();
    await unassignedSymbol.waitFor();
    assert.equal(await assignedSymbol.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(251, 191, 36)','Assigned markers use the same vibrant area color as their appointment blocks');
    assert.equal(await assignedSymbol.evaluate(element=>getComputedStyle(element).opacity),'1','Assigned markers retain full color strength');
    assert.equal(await unassignedSymbol.evaluate(element=>getComputedStyle(element).opacity),'0.72','Unassigned markers remain visibly duller than assigned appointments');
    assert.match(await unassignedSymbol.evaluate(element=>getComputedStyle(element).filter),/saturate\(0\.45\).*grayscale\(0\.18\)/,'Unassigned markers mute the same area palette');
    assert.equal(await page.locator('.appointment-marker.status-completed .map-pin-symbol').innerText(),'✓');
    const canceledSymbol=page.locator('.appointment-marker.status-canceled .map-pin-symbol');
    assert.equal(await canceledSymbol.innerText(),'×');
    assert.equal(await canceledSymbol.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(156, 163, 175)','Cancelled appointments are gray on the current desktop map');
    assert.equal(await canceledSymbol.evaluate(element=>getComputedStyle(element).filter),'grayscale(1)','Cancelled markers cannot retain an active appointment color');
    for(let index=0;index<colors.length;index++) {
      const jk=`JK100${1001+index}`;
      const block=page.locator(`[data-schedule-appointment][aria-label^="${jk} "]`);
      const marker=page.locator(`.appointment-marker[aria-label^="Open appointment ${jk},"]`);
      await marker.waitFor();
      for(const element of [block,marker]) assert.equal((await element.evaluate(e=>getComputedStyle(e).getPropertyValue('--territory-color'))).trim(),colors[index]);
      await block.click();
      const summary=page.getByRole('region',{name:`Selected job ${jk}`,exact:true});
      assert.equal((await summary.evaluate(e=>getComputedStyle(e).getPropertyValue('--territory-color'))).trim(),colors[index]);
      assert.equal(await summary.locator('.selected-job-area').innerText(),areas[index]);
      assert.equal(await marker.getAttribute('aria-pressed'),'true');
      await summary.getByRole('button',{name:'Clear appointment selection'}).click();
      await marker.click();
      await summary.waitFor();
      assert.equal((await block.evaluate(e=>getComputedStyle(e).getPropertyValue('--territory-color'))).trim(),colors[index],'Selection preserves area color');
      await summary.getByRole('button',{name:'Clear appointment selection'}).click();
    }
    assert.match(await page.locator('#fixture-writes').innerText(),/Writes: 0/);
    await page.getByRole('button',{name:'Focus River Parishes',exact:true}).click();
    assert.equal(await page.locator('.appointment-register-row').count(),2,'River Parishes has its own working filter');
    assert.equal(await page.locator('.appointment-territory-group.river-parishes').count(),1);
    assert.equal(await page.locator('.live-map-territories').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'Territory controls fit');
    await page.getByRole('button',{name:'Focus Northshore',exact:true}).click();
    assert.equal(await page.locator('.appointment-register-row').count(),2,'Hammond and Ponchatoula belong to Northshore');
  }
  console.log('Schedule area colors passed at desktop/mobile widths: Westbank, postal aliases, East Metro, parish controls, board/map selection, status preservation and zero writes.');
} finally { await browser.close(); }
