import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 async function fill(suffix=''){
   await page.goto('http://127.0.0.1:3148/tests/prebooking.html'+suffix);
   await page.getByRole('textbox',{name:'Search existing customers'}).fill('Synthetic');await page.getByRole('button',{name:'Use Customer'}).click();
   await page.getByRole('combobox',{name:/JunkWare franchise/i}).selectOption('New Orleans');await page.getByRole('combobox',{name:/^Truck \*/i}).selectOption('Truck 2');await page.getByRole('textbox',{name:/Work description/i}).fill('Synthetic only');
   await page.getByRole('button',{name:'Review Appointment',exact:true}).click();
 }
 await fill();await page.getByRole('region',{name:'Check Existing Appointments'}).waitFor();
 if(process.env.PREBOOKING_SCREENSHOT)await page.screenshot({path:process.env.PREBOOKING_SCREENSHOT});
 assert.equal(await page.getByRole('button',{name:'Create in JunkWare',exact:true}).isEnabled(),false);
 assert.ok((await page.getByRole('link',{name:'Open Existing Appointment'}).getAttribute('href')).includes('appointment='));
 await page.getByRole('checkbox',{name:/I Reviewed These Bookings/}).check();assert.equal(await page.getByRole('button',{name:'Create in JunkWare',exact:true}).isEnabled(),false);
 await page.getByLabel('Reason for a Separate Appointment').fill('Customer requested a second pickup');assert.equal(await page.getByRole('button',{name:'Create in JunkWare',exact:true}).isEnabled(),true);
 await page.getByRole('button',{name:'Edit Details'}).click();await page.getByRole('button',{name:'Review Appointment',exact:true}).click();assert.equal(await page.getByRole('checkbox',{name:/I Reviewed These Bookings/}).isChecked(),false);
 await page.getByRole('checkbox',{name:/I Reviewed These Bookings/}).check();await page.getByRole('button',{name:'Create in JunkWare',exact:true}).click();await page.getByRole('alert').filter({hasText:'Appointments changed'}).waitFor();assert.equal(await page.getByRole('button',{name:'Review Appointment',exact:true}).isVisible(),true);
 await fill('?fail=1');await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Create in JunkWare',exact:true}).count(),0);
 await fill('?clear=1');await page.getByText('No Matching Appointments Found',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Create in JunkWare',exact:true}).isEnabled(),true);
 console.log('Prebooking browser passed: warning, links, explicit reason and checkbox, edit reset, source-change rejection, check failure, and no-match review. No live writes.');
}finally{await browser.close();}
