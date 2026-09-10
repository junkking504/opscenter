import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
try {
 for(const width of [1440,390]) {
  const page=await browser.newPage({viewport:{width,height:900}});
  let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
  await page.goto(`${process.env.ESTIMATE_FIXTURE_URL || 'http://127.0.0.1:3169'}/tests/estimates.html`);
  await page.getByRole('button',{name:'Review JK103',exact:true}).click();
  const charges=page.getByRole('region',{name:'Itemized estimate charges'});
  await charges.waitFor();
  assert.match(await charges.innerText(),/Labor\s+4\s+\$75.00\s+\$300.00/);
  assert.match(await charges.innerText(),/Discount\s+-\$100.00/);
  assert.match(await charges.innerText(),/Quoted total\s+\$1,200.00/);
  assert.ok(await charges.isVisible());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal page overflow');
  const box=await charges.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width);
  await page.screenshot({path:`/tmp/estimate-charges-${width}.png`});
  assert.equal(writes,0);
  await page.close();
 }
 console.log('Estimate charge browser PASS: expanded lines, quantities, unit prices, discount, source quote and mobile fit; no writes.');
} finally {await browser.close();}
