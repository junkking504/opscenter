import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser = await chromium.launch({headless:true});
try {
 const page = await browser.newPage();
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.CAMPAIGN_PREVIEW_URL || 'http://127.0.0.1:3186/tests/campaign.html');
 await page.getByRole('tab',{name:'Reviews',exact:true}).click();
 const input=page.getByRole('combobox',{name:'Appointment ID or JK number'});
 await input.fill('JK1001');
 await page.getByRole('button',{name:'Review job match',exact:true}).click();
 const dialog=page.getByRole('dialog'); await dialog.waitFor();
 await dialog.getByRole('button',{name:'Confirm & save',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 assert.equal(await page.locator('#fixture-posts').innerText(),'Mock saves: 1');
 await page.getByText('Simulate uncertain save').click();
 await input.fill('1001');
 await page.getByRole('button',{name:'Review job match',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm & save',exact:true}).click();
 await dialog.getByText('Mock save result is uncertain.').waitFor();
 assert.equal(await page.locator('#fixture-posts').innerText(),'Mock saves: 2');
 await dialog.getByRole('button',{name:'Check saved result',exact:true}).click();
 await dialog.waitFor({state:'detached'});
 assert.equal(await page.locator('#fixture-posts').innerText(),'Mock saves: 2');
 assert.deepEqual(errors,[]);
 console.log('PASS confirm dialog submits, closes after verified save, and recovers uncertain receipt without replay.');
} finally {await browser.close();}
