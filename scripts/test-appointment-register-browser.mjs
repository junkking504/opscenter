import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.route('https://junkware.junk-king.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="purple"/></svg>'}));
  for (const width of [1440,1280,1024,768,390,320]) {
    await page.setViewportSize({width,height:1000});
    await page.goto('http://127.0.0.1:3156/tests/appointment-register.html');
    await page.getByRole('cell',{name:'Payment for JK10001',exact:true}).waitFor();
    assert.match(await page.getByRole('cell',{name:'Payment for JK10001',exact:true}).innerText(),/\$100.00/);
    assert.match(await page.getByRole('cell',{name:'Payment for JK10002',exact:true}).innerText(),/Balance due \$50.00/);
    assert.match(await page.getByRole('cell',{name:'Payment for JK10003',exact:true}).innerText(),/Estimate quoted/);
    assert.match(await page.getByRole('cell',{name:'Payment for JK10005',exact:true}).innerText(),/Billed · not confirmed paid/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),`${width}: no page overflow`);
    const geometry=await page.locator('.readable-appointment').nth(1).evaluate(row=>({cells:[...row.children].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}),amountSize:parseFloat(getComputedStyle(row.querySelector('.register-payment-amount')).fontSize)}));
    assert.ok(geometry.amountSize>=22);
    for(let i=0;i<geometry.cells.length;i++)for(let j=i+1;j<geometry.cells.length;j++){const a=geometry.cells[i],b=geometry.cells[j];assert.ok(!(a.x<b.right&&b.x<a.right&&a.y<b.bottom&&b.y<a.bottom),`${width}: cells do not overlap`);}
    await page.getByRole('button',{name:'JK10001',exact:true}).click();
    await page.getByRole('button',{name:'View details for JK10001',exact:true}).click();
    await page.getByText('Opened JK10001',{exact:true}).waitFor();
    const quoted=page.getByRole('cell',{name:'Payment for JK10007',exact:true});
    assert.match(await quoted.innerText(),/Prior estimate · \$1,200.00/);
    assert.match(await quoted.innerText(),/No payment recorded/);
    assert.ok(!(await quoted.innerText()).includes('$1,350'),'current job charge cannot replace original quote');
    assert.equal(await quoted.getByRole('link').getAttribute('href'),'https://junkware.junk-king.com/franchise/appointment.aspx?id=123');
    await page.getByRole('button',{name:'View details for JK10007',exact:true}).click();
    await page.getByRole('img',{name:'Before job photo'}).waitFor();
    await page.getByRole('img',{name:'Before job photo'}).scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>{const img=document.querySelector('.source-estimate img');return img?.complete&&img.naturalWidth>0;});
    assert.equal(await page.getByRole('img',{name:'Before job photo'}).evaluate(img=>img.complete&&img.naturalWidth>0),true);
    if(width===1440)await page.screenshot({path:'/tmp/opscenter-appointment-register-desktop.png',fullPage:true});
    if(width===390)await page.screenshot({path:'/tmp/opscenter-appointment-register-mobile.png',fullPage:true});
  }
  console.log('Appointment register browser passed at 320–1440px: readable payment amount, no overlaps/overflow, paid/due/quote/billed states, selection and detail opening. Synthetic only.');
} finally { await browser.close(); }
