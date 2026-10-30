import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
const base=process.env.PREBOOKING_BASE || 'http://127.0.0.1:3148';
try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const day=new Date(Date.now()+86400000).toLocaleDateString('en-CA',{timeZone:'America/Chicago'});
  for(const query of ['','?fail=1','?duplicate=1']){
   await page.goto(base+'/tests/estimate-booking-refresh.html'+query);
   await page.getByRole('button',{name:'Book Job',exact:true}).click();await page.getByLabel('Job date',{exact:true}).fill(day);await page.getByPlaceholder('Add details for the job…').fill('Keep these details');
   await page.getByRole('button',{name:'Review Job Booking'}).click();await page.getByRole('button',{name:'Checking date in JunkWare…'}).waitFor();
   assert.equal(await page.getByLabel('Job date',{exact:true}).isDisabled(),true);
   if(query.includes('fail')){await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Book Job in JunkWare',exact:true}).count(),0);}
   else{await page.getByRole('button',{name:'Book Job in JunkWare',exact:true}).waitFor();if(query.includes('duplicate'))assert.equal(await page.getByRole('button',{name:'Book Job in JunkWare',exact:true}).isEnabled(),false);}
   assert.equal(await page.getByLabel('Job date',{exact:true}).inputValue(),day);assert.equal(await page.getByPlaceholder('Add details for the job…').inputValue(),'Keep these details');assert.equal(await page.locator('#requests').textContent(),'3');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(process.env.QA_OUTPUT && !query)await page.screenshot({path:`${process.env.QA_OUTPUT}/booking-${width}.png`,fullPage:true});
  }
  await page.close();
 }
 console.log('Estimate booking UI passed at 1440/390: progress, retained date/notes, fresh review, failure, duplicate confirmation, no overflow or writes.');
}finally{await browser.close();}
