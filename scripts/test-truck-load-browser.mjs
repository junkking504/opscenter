import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://127.0.0.1:3128/tests/truck-loads.html');
  const truck=page.getByRole('button',{name:'Select Truck 4 on map',exact:true});
  await truck.waitFor();
  assert.equal(await page.locator('.schedule-board.compact').count(),1,'Exercise the actual seven-truck density rules');
  const load=truck.getByText('1/2 full',{exact:true});
  assert.equal(await load.isVisible(),true,'Compact board must not hide truck loads');
  const box=await truck.boundingBox(), label=await load.boundingBox();
  assert.ok(label && box && label.y>=box.y && label.y+label.height<=box.y+box.height,'Load fits inside the truck row');
  await page.screenshot({path:'/tmp/opscenter-truck-load-schedule.png',fullPage:true});
  await page.getByRole('button',{name:'Fleet preview',exact:true}).click();
  await page.getByRole('heading',{name:'Truck Load Status',exact:true}).waitFor();
  assert.equal(await page.getByText('1/4 full',{exact:true}).isVisible(),true);
  assert.equal(await page.getByText('1/2 full',{exact:true}).isVisible(),true);
  assert.equal(await page.getByText('Verify load',{exact:true}).isVisible(),true);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Schedule preview',exact:true}).click();
  await page.getByRole('button',{name:'Select Truck 4 on map',exact:true}).waitFor();
  assert.equal(await page.getByText('1/2 full',{exact:true}).isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  console.log('Truck-load browser checks passed: seven-truck compact board, fraction labels, Fleet parity, uncertainty and mobile overflow.');
} finally {await browser.close();}
