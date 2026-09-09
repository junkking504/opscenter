import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  for(const [width,height] of [[1440,900],[1361,768],[1024,768],[900,768],[768,700],[390,844],[320,640]]) {
    await page.setViewportSize({width,height});
    await page.goto('http://127.0.0.1:3156/tests/schedule-destinations.html?scenario=same-time&details=long');
    await page.locator('[data-schedule-appointment]').first().click();
    await page.locator('.map-selected-appointment').waitFor();
    await page.locator('.route-candidate-row').first().waitFor();
    const geometry=await page.evaluate(()=>{
      const box=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,client:el.clientHeight,scroll:el.scrollHeight};};
      return {panel:box('.schedule-map-panel'),controls:box('.schedule-map-controls'),summary:box('.map-selected-appointment'),card:box('.route-intelligence-panel'),map:box('.schedule-map-canvas'),list:box('.route-candidate-list'),children:[...document.querySelector('.map-selected-appointment').children].map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,top:r.top,bottom:r.bottom,left:r.left,right:r.right};})};
    });
    assert.ok(geometry.controls.scroll<=geometry.controls.client+1,`No clipped/scrolling summary at ${width}: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.summary.scroll<=geometry.summary.client+1);
    assert.ok(geometry.card.bottom<=geometry.controls.bottom+1 && geometry.controls.bottom<=geometry.panel.bottom+1);
    assert.ok(geometry.map.height>=200,'Keep a usable map');
    assert.ok(geometry.summary.top>=geometry.map.bottom,'Details stay below, not over, the map');
    assert.ok(geometry.list.height<=145 && geometry.list.scroll>geometry.list.client,'Only truck comparison scrolls');
    for(const child of geometry.children) {
      assert.ok(child.bottom<=geometry.controls.bottom+1 && child.bottom<=geometry.card.bottom+1,`Visible ${child.text}`);
      assert.ok(child.left>=geometry.panel.left && child.right<=geometry.panel.right+1,`Wrapped ${child.text}`);
    }
    assert.equal(await page.locator('.map-selected-appointment p').isVisible(),true,'Address warning is readable');
    assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
    await page.locator('.route-intelligence-panel').scrollIntoViewIfNeeded();
    if(width===1361||width===390)await page.screenshot({path:`/tmp/selected-appointment-layout-${width}.png`});
  }
  console.log('Selected appointment layout PASS at 320–1440px: full summary, wrapped address/work, visible warning, usable map, bounded truck list, zero writes.');
} finally {await browser.close();}
