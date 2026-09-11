import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
  for(const result of ['verified','uncertain']) {
    const page=await browser.newPage({viewport:{width:390,height:900}});
    await page.goto(`http://127.0.0.1:3156/tests/schedule-destinations.html?scenario=same-time&result=${result}`);
    await page.locator('.day-switcher button').first().click();
    await page.getByRole('button',{name:'View details for JK1001001',exact:true}).click();
    const drawer=page.getByRole('dialog',{name:'JK1001001',exact:true});
    const shortcut=drawer.getByRole('button',{name:'Cancel Appointment',exact:true});
    await shortcut.click(); // Wait for the drawer entrance animation to settle.
    const box=await shortcut.boundingBox();
    assert.ok(box.x>=0 && box.x+box.width<=390 && box.y>=0 && box.y+box.height<=900,'Persistent cancellation action fits viewport');
    await drawer.getByRole('textbox',{name:'Cancellation Reason',exact:true}).fill('Synthetic cancellation only');
    await drawer.getByRole('button',{name:'Review Cancellation',exact:true}).click();
    assert.match(await page.locator('#fixture-writes').innerText(),/^Writes: 0/,'Review never submits');
    await drawer.getByRole('button',{name:'Confirm Cancellation',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#fixture-writes').textContent.startsWith('Writes: 1'));
    if(result==='verified') {
      await page.waitForFunction(()=>!document.querySelector('.drawer-cancel-shortcut'));
      assert.equal(await drawer.getByRole('region',{name:'Cancel Appointment',exact:true}).count(),0,'Canceled appointment cannot be canceled again');
      assert.match(await drawer.innerText(),/Canceled/,'Verified source read-back updates the drawer');
    } else {
      await drawer.getByRole('button',{name:'Check Saved Result',exact:true}).waitFor();
      assert.equal(await drawer.getByRole('button',{name:'Confirm Cancellation',exact:true}).isEnabled(),false,'Uncertain cancellation cannot be resubmitted');
      assert.equal(await drawer.getByRole('textbox',{name:'Cancellation Reason',exact:true}).isEnabled(),false);
    }
    assert.match(await page.locator('#fixture-writes').innerText(),/^Writes: 1/,'Exactly one synthetic cancellation was submitted');
    await page.close();
  }
  console.log('Cancellation UI passed: visible shortcut, required reason, review without write, verified read-back, and uncertain no-replay. Synthetic only.');
} finally {await browser.close();}
