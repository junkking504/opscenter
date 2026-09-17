import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
async function main() {
const html=path.resolve(process.argv[2] || '/tmp/opscenter-mobile-closeout-preview/index.html');
const browser=await chromium.launch({headless:true});
try {
  for(const width of [320,390,430,1024]) {
    const page=await browser.newPage({viewport:{width,height:844}});
    const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    const network:string[]=[];page.on('request',request=>{if(/^https?:/.test(request.url())) network.push(request.url());});
    await page.goto(pathToFileURL(html).href);
    await expect(page.getByRole('heading',{name:'Today’s jobs'})).toBeVisible();
    if(width===390) await page.screenshot({path:path.join(path.dirname(html),'mobile-home.png'),fullPage:true});
    await page.getByRole('button').filter({has:page.getByRole('heading',{name:'Sample Customer B'})}).click();
    await page.getByRole('button',{name:'Photos',exact:true}).click();
    await page.getByLabel('Add before photos',{exact:true}).setInputFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64')});
    await expect(page.getByRole('img',{name:'Before: sample.png'})).toBeVisible();
    await page.getByRole('button',{name:'Remove sample.png',exact:true}).click();
    await expect(page.getByRole('img',{name:'Before: sample.png'})).toHaveCount(0);
    await page.getByRole('button',{name:'Close out',exact:true}).click();
    await page.getByRole('radio',{name:'Completed',exact:true}).check();
    await page.getByRole('button',{name:'Continue to charges',exact:true}).click();
    const price=page.getByRole('textbox',{name:'Load price',exact:true});
    await price.fill('425');
    await page.getByRole('button',{name:'Back to appointment',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Items to remove'})).toBeVisible();
    await page.getByRole('button',{name:'Close out',exact:true}).click();
    await expect(price).toHaveValue('425');
    await page.getByRole('button',{name:'Continue to payment',exact:true}).click();
    await page.getByRole('checkbox',{name:'Add a payment',exact:true}).check();
    await page.getByRole('radio',{name:'Credit Card',exact:true}).check();
    await page.getByRole('textbox',{name:'Payment amount',exact:true}).fill('425');
    await page.getByRole('button',{name:'Review Closeout',exact:true}).click();
    await expect(page.getByRole('alert').last()).toBeVisible();
    await expect(page.getByRole('button',{name:'Confirm Job Closeout in JunkWare',exact:true})).toHaveCount(0);
    await page.locator('input[maxlength="4"]').fill('1234');
    await page.getByRole('button',{name:'Review Closeout',exact:true}).click();
    await expect(page.getByLabel('Closeout review')).toContainText('$425.00');
    await expect(page.getByLabel('Closeout review')).toContainText('1234');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No horizontal overflow at ${width}`);
    if(width===390) await page.screenshot({path:path.join(path.dirname(html),'mobile-review.png'),fullPage:true});
    await page.getByRole('button',{name:'Confirm Job Closeout in JunkWare',exact:true}).click();
    await expect(page.getByText('Preview only. No appointment or payment was sent to JunkWare.',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'1 Details',exact:true}).click();
    await expect(page.getByRole('combobox',{name:'Appointment truck'})).toBeEnabled();
    assert.deepEqual(network,[],'Preview never requests external services');
    assert.deepEqual(errors,[],'No browser runtime errors');
    await page.close();
    console.log(`PASS ${width}px: navigation, draft retention, payment validation, review, isolated confirmation, no overflow`);
  }
} finally {await browser.close();}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
