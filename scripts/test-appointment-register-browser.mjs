import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  for (const width of [1440,1280,1024,768,390,320]) {
    await page.setViewportSize({width,height:1000});
    await page.goto('http://127.0.0.1:3156/tests/appointment-register.html');
    await page.getByRole('cell',{name:'Payment for JK10001',exact:true}).waitFor();
    assert.match(await page.getByRole('cell',{name:'Payment for JK10001',exact:true}).innerText(),/\$100.00/);
    assert.match(await page.getByRole('cell',{name:'Payment for JK10002',exact:true}).innerText(),/Balance due \$50.00/);
    assert.match(await page.getByRole('cell',{name:'Payment for JK10003',exact:true}).innerText(),/Estimate quoted/);
    assert.match(await page.getByRole('cell',{name:'Payment for JK10005',exact:true}).innerText(),/Billed · not confirmed paid/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),`${width}: no page overflow`);
    const geometry=await page.locator('.readable-appointment').first().evaluate(row=>({cells:[...row.children].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}),amountSize:parseFloat(getComputedStyle(row.querySelector('.register-payment-amount')).fontSize)}));
    assert.ok(geometry.amountSize>=22);
    for(let i=0;i<geometry.cells.length;i++)for(let j=i+1;j<geometry.cells.length;j++){const a=geometry.cells[i],b=geometry.cells[j];assert.ok(!(a.x<b.right&&b.x<a.right&&a.y<b.bottom&&b.y<a.bottom),`${width}: cells do not overlap`);}
    await page.getByRole('button',{name:'JK10001',exact:true}).click();
    await page.getByRole('button',{name:'View details for JK10001',exact:true}).click();
    await page.getByText('Opened JK10001',{exact:true}).waitFor();
    if(width===1440)await page.screenshot({path:'/tmp/opscenter-appointment-register-desktop.png',fullPage:true});
    if(width===390)await page.screenshot({path:'/tmp/opscenter-appointment-register-mobile.png',fullPage:true});
  }
  console.log('Appointment register browser passed at 320–1440px: readable payment amount, no overlaps/overflow, paid/due/quote/billed states, selection and detail opening. Synthetic only.');
} finally { await browser.close(); }
