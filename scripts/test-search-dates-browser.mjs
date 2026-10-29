import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto('http://127.0.0.1:3148/tests/search-dates.html');
 const search=page.getByRole('textbox',{name:'Ask OpsBot or search records'});await search.fill('Synthetic');
 await page.getByText('10 of 12',{exact:true}).waitFor();
 await search.fill('100 Example');
 await page.getByRole('button',{name:/Historical Customer · JK1000001/}).waitFor();
 assert.ok(await page.getByText(/No collected appointment dates/).count(),'History must appear without a collected date');
 await search.press('Enter');assert.equal(await page.getByRole('alert').count(),0,'Identifier Enter must not submit to OpsBot');
 await search.fill('101 Example');await page.getByRole('button',{name:/Historical Customer · JK1000001/}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Recent Customer · JK1000002/}).count(),1,'Keep newer saved matches alongside missing history');
 await search.fill('102 Example');await page.getByRole('alert').waitFor();
 assert.match(await page.getByRole('alert').innerText(),/Older appointments may be missing/);
 assert.equal(await page.getByText(/No matching appointments found/).count(),0);
 await search.fill('104 Example');await page.getByText(/No matching appointments found/).waitFor();
 await search.fill('Synthetic');await page.getByText('10 of 12',{exact:true}).waitFor();
 const firstResult=page.getByRole('button',{name:/Synthetic Customer · JK1000000/});
 assert.equal(await firstResult.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Search results must paint above the Schedule board');
 const backdrop=page.getByRole('button',{name:'Close search',exact:true});
 const backdropBox=await backdrop.boundingBox();assert.ok(backdropBox&&backdropBox.height>=900,'Search backdrop must cover the viewport, not only the blurred header');
 await page.getByRole('button',{name:'Upcoming',exact:true}).click();await page.getByText('10 of 12',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Upcoming',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Show More Appointments'}).click();await page.getByText('12 of 12',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Past',exact:true}).click();await page.getByText(/No matching saved records/).waitFor();
 await page.getByRole('button',{name:'All',exact:true}).click();await page.getByText('10 of 12',{exact:true}).waitFor();
 await search.fill('fail');await page.getByRole('alert').waitFor();assert.equal(await page.getByText(/No matching saved records/).count(),0,'Failure must not claim there are no appointments');
 for(const query of ['html search','expired']) {
  await search.fill(query);await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(),query==='expired'?/session has expired/:/Saved-record search is temporarily unavailable/);
  assert.equal(await page.getByText(/No matching saved records/).count(),0);
 }
 for(const query of ['html local','html paid']) {
  await search.fill(query);await page.getByRole('button',{name:'Ask OpsBot',exact:true}).click();
  const alert=page.getByRole('alert');await alert.waitFor();
  assert.match(await alert.innerText(),query==='html local'?/saved-source lookup is temporarily unavailable/:/submitted pilot question may still count/);
  assert(!/Unexpected token|DOCTYPE/.test(await alert.innerText()));
 }
 await search.fill('slow');await page.waitForTimeout(250);await search.fill('Synthetic');await page.getByText('10 of 12',{exact:true}).waitFor();await page.waitForTimeout(750);assert.equal(await page.getByText('Stale Response',{exact:true}).count(),0);
 if(process.env.SEARCH_SCREENSHOT)await page.screenshot({path:process.env.SEARCH_SCREENSHOT});
 await search.press('Escape');assert.equal(await page.getByRole('dialog',{name:'OpsCenter launcher'}).count(),0);await search.click();await page.getByText('10 of 12',{exact:true}).waitFor();
 await page.route('**/desktop?**',route=>route.fulfill({contentType:'text/html',body:'<h1>Synthetic appointment destination</h1>'}));
 await page.getByRole('button',{name:/Synthetic Customer · JK1000000/}).click();await page.waitForURL('**/desktop?**');const dest=new URL(page.url());assert.equal(dest.searchParams.get('date'),'2026-09-09');assert.equal(dest.searchParams.get('appointment'),'1000');
 console.log('Browser search passed: scopes, more results, failure state, stale-response protection, Escape/reopen and exact future appointment destination. Synthetic only.');
}finally{await browser.close();}
