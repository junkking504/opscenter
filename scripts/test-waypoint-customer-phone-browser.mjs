import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const origin = process.argv[2] || 'http://127.0.0.1:3196';
const date = '2026-09-30';
const phone = {deviceId:'synthetic-phone',truck:'Truck 6',label:'Synthetic company phone',enrolledAt:'2026-09-30T12:00:00.000Z',expiresAt:'2026-10-01T05:00:00.000Z'};
const day = {deviceId:phone.deviceId,truck:phone.truck,date,version:1,requestId:'synthetic-day',responsible:'Sample Driver',driver:'Sample Driver',navigators:['Sample Navigator'],savedAt:'2026-09-30T12:00:00.000Z'};
const job = {assignmentId:'00000000-0000-4000-8000-000000000001',appointmentId:'900001',date,jkNumber:'SAMPLE-01',customerName:'Sample Customer',phone:'(225) 555-0101',address:'100 Sample Street, Baton Rouge, LA 70801',appointmentTime:'11:00 AM–12:00 PM',junkItems:['Sample pickup'],appointmentNotes:['Synthetic browser fixture.'],driver:'Sample Driver',navigator:'Sample Navigator',status:'Confirmed'};

const browser = await chromium.launch({headless:true});
try {
  for (const width of [320,390,430]) {
    const context = await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
    const page = await context.newPage();
    const errors = [];
    let writes = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/crew-jobs/**', async route => {
      const request = route.request();
      if (request.method() !== 'GET') writes++;
      const pathname = new URL(request.url()).pathname;
      const send = body => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      if (pathname === '/api/crew-jobs/session') return send({phone});
      if (pathname === '/api/crew-jobs/day') return send({date,day,roster:['Sample Driver','Sample Navigator'],trucks:['Truck 6'],phone,inspection:{status:'ready'},switch:null});
      if (pathname === '/api/crew-jobs/current') return send({state:'assigned',truck:phone.truck,job,jobs:[job],observedAt:'2026-09-30T12:00:00.000Z',updateToken:'synthetic-update'});
      if (pathname === '/api/crew-jobs/updates') return send({updateToken:'synthetic-update'});
      throw new Error(`Unexpected API ${request.method()} ${pathname}`);
    });
    await page.goto(`${origin}/crew-jobs`);
    await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();
    const number = page.getByRole('link',{name:/Call \(225\) 555-0101/}).first();
    await expect(number).toHaveAttribute('href','tel:+12255550101');
    await expect(number).toHaveAttribute('title','Tap to call. Touch and hold for call or message options.');
    await number.dispatchEvent('pointerdown',{pointerType:'touch',clientX:40,clientY:40});
    await page.waitForTimeout(650);
    await number.dispatchEvent('pointerup',{pointerType:'touch',clientX:40,clientY:40});
    const actions = page.getByRole('group',{name:'Contact (225) 555-0101'});
    await expect(actions.getByRole('link',{name:'Call customer',exact:true})).toHaveAttribute('href','tel:+12255550101');
    await expect(actions.getByRole('link',{name:'Message customer',exact:true})).toHaveAttribute('href','sms:+12255550101');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,`Long-press actions fit at ${width}px`);
    if (width === 390) await page.screenshot({path:'/tmp/waypoint-customer-phone-actions-390.png',fullPage:true});
    await actions.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('button',{name:'View assignment',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Assignment details',exact:true})).toBeVisible();
    await expect(page.getByRole('link',{name:/Call \(225\) 555-0101/})).toHaveAttribute('href','tel:+12255550101');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,`No horizontal overflow at ${width}px`);
    assert.equal(writes,0,'The customer-phone presentation test must not write operational data');
    assert.deepEqual(errors,[]);
    if (width === 390) await page.screenshot({path:'/tmp/waypoint-customer-phone-390.png',fullPage:true});
    await context.close();
  }
  console.log('Waypoint customer phone passed at 320, 390 and 430px: visible number, tap-to-call link, touch-and-hold Call/Message actions, assignment-detail persistence, no overflow, zero writes.');
} finally {
  await browser.close();
}
