import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  for(const width of [1440,1024,768,390,320]) {
    await page.setViewportSize({width,height:1000});
    await page.goto('http://127.0.0.1:3156/tests/schedule-destinations.html?scenario=same-time');
    const block=page.locator('[data-schedule-appointment]').first();
    await block.waitFor();
    const orderButton=page.getByRole('button',{name:'Stop Order',exact:true});
    await orderButton.click();
    const orderDialog=page.getByRole('dialog',{name:'Order Same-Time Appointments',exact:true});
    assert.equal(await orderDialog.locator('.stop-order-row').count(),4,'all four same-time stops available with map open');
    await orderDialog.getByRole('button',{name:'Cancel',exact:true}).click();
    const baselineWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
    await block.click();
    const mapDetails=page.getByRole('button',{name:'Full details for JK1001001 from map',exact:true});
    const boardDetails=page.getByRole('button',{name:'Full details for JK1001001 from truck schedule',exact:true});
    await mapDetails.waitFor();await boardDetails.waitFor();
    for(const button of [mapDetails,boardDetails,orderButton]) {
      const r=await button.boundingBox();assert.ok(r.height>=36,'large click target');
      assert.ok(r.x>=0&&r.x+r.width<=width+1,'button fits width');
    }
    await boardDetails.click();
    await page.getByRole('dialog',{name:'JK1001001',exact:true}).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).first().click();
    assert.equal(await block.getAttribute('aria-pressed'),'true','closing preserves dispatch selection');
    await page.getByRole('button',{name:'Synthetic map marker JK1001001',exact:true}).click();
    await mapDetails.click();
    await page.getByRole('dialog',{name:'JK1001001',exact:true}).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await block.getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0','details must never trigger writes');
    const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(el=>[el.tagName,el.className,el.getBoundingClientRect().right])}));
    assert.ok(overflow.scroll<=Math.max(width,baselineWidth)+1,JSON.stringify(overflow));
    if(width===1440||width===390)await page.screenshot({path:`/tmp/dispatch-details-${width}.png`,fullPage:true});
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('.dispatch-full-details'));
  }
  console.log('Dispatch details PASS: map and timeline open same full drawer, 320–1440px controls, close preserves selection, Escape resets, zero writes. Synthetic only.');
} finally {await browser.close();}
