import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
  for(const width of [320,390,1280]) for(const result of ['verified','uncertain','failed']) {
    const page=await browser.newPage({viewport:{width,height:900}});
    await page.goto('http://127.0.0.1:3156/tests/schedule-destinations.html?scenario=same-time&result='+result);
    await page.locator('.day-switcher button').first().click();
    await page.getByRole('button',{name:'View details for JK1001001',exact:true}).click();
    const drawer=page.getByRole('dialog',{name:'JK1001001',exact:true});
    await drawer.getByRole('button',{name:'Reschedule Appointment',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'appointment-reschedule-date');
    const region=drawer.getByRole('region',{name:'Reschedule Appointment',exact:true});
    assert.equal(await region.getByRole('button',{name:'Review Reschedule',exact:true}).isEnabled(),false);
    await region.locator('input[type=date]').fill('2026-09-15');
    await region.getByRole('combobox',{name:'New Appointment Window',exact:true}).selectOption('600');
    await region.getByRole('button',{name:'Review Reschedule',exact:true}).click();
    assert.match(await region.innerText(),/2026-09-15/);
    assert.match(await page.locator('#fixture-writes').innerText(),/^Writes: 0/);
    await region.getByRole('button',{name:'Keep Appointment',exact:true}).click();
    assert.match(await page.locator('#fixture-writes').innerText(),/^Writes: 0/);
    await region.getByRole('button',{name:'Review Reschedule',exact:true}).click();
    await page.evaluate(()=>{const fetch=window.fetch;window.fetch=(input,init)=>{if(init?.method==='POST')window.syntheticSubmission=JSON.parse(init.body);return fetch(input,init);};});
    await region.getByRole('button',{name:'Confirm Reschedule',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#fixture-writes').textContent.startsWith('Writes: 1'));
    const body=await page.evaluate(()=>window.syntheticSubmission);
    assert.equal(body.action,'reschedule');
    assert.deepEqual(body.values,{destinationDate:'2026-09-15',appointmentStartMinutes:600});
    assert.equal(body.recordId,body.date+':appointment:1001');
    if(result==='verified') assert.match(await region.innerText(),/reschedule is verified/);
    if(result==='uncertain') {
      assert.equal(await region.locator('input[type=date]').isEnabled(),false);
      await region.getByRole('button',{name:'Check Saved Result',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#appointment-reschedule').textContent.includes('reschedule is verified'));
      assert.match(await page.locator('#fixture-writes').innerText(),/^Writes: 1/,'Read-back does not replay');
    }
    if(result==='failed') await region.getByRole('button',{name:'Review and Correct',exact:true}).click();
    const footer=await drawer.locator('.record-drawer-actions').boundingBox();
    assert.ok(footer.x>=0 && footer.x+footer.width<=width && footer.y+footer.height<=900);
    await page.close();
  }
  console.log('Reschedule drawer passed at 320, 390 and 1280px: date/time, explicit review, cancel without write, exact source identity, one submit, verified/failed/uncertain read-only recovery.');
} finally {await browser.close();}
