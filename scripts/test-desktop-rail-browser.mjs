import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1280,height:720}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.fulfill({status:204}));
await page.goto('http://127.0.0.1:3158/tests/aspect-ratio.html?workspace=Command&commandMap=1&date=2026-09-12');
await page.waitForSelector('.page-rail-link');
const targets=await page.locator('.page-rail-link').evaluateAll(links=>links.map(link=>({href:link.getAttribute('href'),label:link.textContent})));
assert.ok(targets.length >= 29);
for(const [index, {href,label}] of targets.entries()){
 const target=page.locator('.page-rail-link').nth(index);
 await target.click();
 await page.waitForFunction(index=>document.querySelectorAll('.page-rail-link')[index]?.getAttribute('aria-current')==='page',index);
 const expected=new URL(href,page.url()); assert.equal(new URL(page.url()).searchParams.get('workspace'),expected.searchParams.get('workspace'));
 assert.equal(await page.locator('.page-rail-link[aria-current="page"]').count(),1);
 assert.equal(new URL(page.url()).searchParams.get('date'),'2026-09-12');
 assert.equal(await page.locator('.workspace').count(),1);
 console.log(`Reachable and active: ${label}`);
}
await page.locator('.page-rail-link').first().focus();await page.keyboard.press('Enter');
await page.waitForFunction(()=>document.querySelector('.page-rail-link[aria-current="page"]')?.textContent==='Updates');
await page.getByRole('tab',{name:'Alerts',exact:false}).focus();await page.keyboard.press('ArrowRight');
assert.equal(await page.getByRole('tab',{name:'Control',exact:true}).getAttribute('aria-selected'),'true');
assert.deepEqual(errors,[]);
await browser.close();console.log('Rail reachability, active state, historical date and keyboard navigation passed.');
