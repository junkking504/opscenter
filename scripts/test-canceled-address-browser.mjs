import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  await page.goto(`${process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3159'}/tests/schedule-destinations.html?scenario=same-time&details=long&routes=address`);
  await page.locator('[data-schedule-appointment]').first().waitFor();
  await page.evaluate(()=>{
    const syntheticFetch=window.fetch;
    window.fetch=async(input,init)=>{
      const url=new URL(String(input),location.origin);
      if(url.pathname==='/api/desktop/schedule/routes') return new Promise(()=>{});
      const response=await syntheticFetch(input,init);
      if(url.pathname!=='/api/desktop/schedule') return response;
      const body=await response.json();
      body.appointments[0].status='Cancelled by Dispatcher';
      body.appointments[0].version='canceled';
      return Response.json(body);
    };
  });
  await page.getByRole('button',{name:'Refresh day',exact:true}).click();
  const block=page.locator('[data-schedule-appointment]').first();
  await page.waitForFunction(()=>document.querySelector('[data-schedule-appointment]')?.getAttribute('aria-label')?.includes('Canceled'));
  const verify=page.getByRole('button',{name:/Verify Address/}).first();
  assert.match(await verify.innerText(),/3/,'Only the three active unverified appointments count');
  await block.click();
  const summary=page.getByRole('region',{name:'Selected job JK1001001',exact:true});
  assert.match(await summary.innerText(),/Canceled/);
  assert.doesNotMatch(await summary.innerText(),/Verify address first|Closest truck now|Checking distance/);
  assert.doesNotMatch(await page.locator('.register-status').allTextContents().then(rows=>rows.join(' ')),/Closest truck|checking current distance/,'Canceled register status does not imply a pending address or route lookup');
  await summary.getByRole('button',{name:'Full details for JK1001001',exact:true}).click();
  await page.locator('.record-drawer').waitFor();
  assert.match(await page.locator('#fixture-writes').innerText(),/Writes: 0/);
  console.log('Canceled address browser passed: cancellation renders while routes hang, active-only address count, canceled summary and details remain usable, zero writes.');
} finally {
  await browser.close();
}
