import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto('http://127.0.0.1:3148/tests/search-dates.html');
 const search=page.getByRole('textbox',{name:'Search records or run an OpsCenter command'});await search.fill('Synthetic');
 await page.getByText('10 of 12',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Upcoming',exact:true}).click();await page.getByText('10 of 12',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Upcoming',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Show More Appointments'}).click();await page.getByText('12 of 12',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Past',exact:true}).click();await page.getByText(/No matching records in this search/).waitFor();
 await page.getByRole('button',{name:'All',exact:true}).click();await page.getByText('10 of 12',{exact:true}).waitFor();
 await search.fill('fail');await page.getByRole('alert').waitFor();assert.equal(await page.getByText(/No matching records in this search/).count(),0,'Failure must not claim there are no appointments');
 await search.fill('slow');await page.waitForTimeout(250);await search.fill('Synthetic');await page.getByText('10 of 12',{exact:true}).waitFor();await page.waitForTimeout(750);assert.equal(await page.getByText('Stale Response',{exact:true}).count(),0);
 if(process.env.SEARCH_SCREENSHOT)await page.screenshot({path:process.env.SEARCH_SCREENSHOT});
 await search.press('Escape');assert.equal(await page.getByRole('dialog',{name:'OpsCenter launcher'}).count(),0);await search.click();await page.getByText('10 of 12',{exact:true}).waitFor();
 await page.route('**/desktop?**',route=>route.fulfill({contentType:'text/html',body:'<h1>Synthetic appointment destination</h1>'}));
 await page.getByRole('button',{name:/Synthetic Customer · JK1000000/}).click();await page.waitForURL('**/desktop?**');const dest=new URL(page.url());assert.equal(dest.searchParams.get('date'),'2026-09-09');assert.equal(dest.searchParams.get('appointment'),'1000');
 console.log('Browser search passed: scopes, more results, failure state, stale-response protection, Escape/reopen and exact future appointment destination. Synthetic only.');
}finally{await browser.close();}
