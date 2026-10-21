import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const base=process.env.CUSTOMER_EDITOR_TEST_BASE || 'http://127.0.0.1:3186';
const browser=await chromium.launch();
try{
 for(const width of [390,1280])for(const result of ['verified','uncertain']){
  const page=await browser.newPage({viewport:{width,height:900}});
  const url=base+`/tests/customer-editor.html?result=${result}`;
  await page.goto(url);await page.getByRole('button',{name:'Edit Customer',exact:true}).click();
  await page.getByRole('textbox',{name:'First name',exact:true}).fill('Updated');await page.getByRole('button',{name:'Review Changes',exact:true}).click();
  assert.match(await page.locator('.customer-edit-review').innerText(),/Test → Updated/);
  await page.getByRole('button',{name:'Save Customer in JunkWare',exact:true}).click();await page.waitForFunction(()=>window.writes===1);
  if(result==='verified')await page.waitForFunction(()=>window.saved===true);
  else{
   await page.getByRole('button',{name:'Check Saved Result'}).waitFor();await page.reload();await page.getByRole('button',{name:'Check Saved Result'}).waitFor();
   await page.goto(url+'&actor=manager-two');assert.equal(await page.getByRole('button',{name:'Check Saved Result'}).count(),0);await page.getByRole('button',{name:'Edit Customer',exact:true}).click();await page.getByRole('textbox',{name:'First name',exact:true}).waitFor();
   await page.goto(url);await page.getByRole('button',{name:'Check Saved Result'}).waitFor();await page.getByRole('button',{name:'Check Saved Result'}).click();await page.getByRole('alert').waitFor();
   await page.getByRole('checkbox',{name:'I reviewed this appointment in JunkWare.'}).check();await page.getByRole('button',{name:'Finish Manual Review'}).click();await page.getByText('Manager reviewed source. No source save.').waitFor();assert.equal(await page.evaluate(()=>window.writes),0,'Manual review never saves customer fields');
   assert.equal(await page.getByRole('button',{name:'Edit Customer',exact:true}).isEnabled(),true);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();
 }
 const operator=await browser.newPage();await operator.goto(base+'/tests/customer-editor.html?role=operator');await operator.waitForTimeout(500);assert.equal(await operator.getByRole('button',{name:'Edit Customer',exact:true}).count(),0);await operator.close();
 console.log('Customer editor UI passed: desktop/mobile, review/save, actor-scoped recovery, shared workstation switch, 404 manual-review exit without source writes, hidden operator editor.');
}finally{await browser.close();}
