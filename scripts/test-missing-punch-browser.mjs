import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, webkit } from 'playwright';
const origin=process.env.MISSING_PUNCH_PREVIEW_URL || 'http://127.0.0.1:3308';
const evidence=process.env.MISSING_PUNCH_EVIDENCE || '/tmp/missing-punch-browser';
fs.mkdirSync(evidence,{recursive:true});
const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch({headless:true});
 try {
  for(const [width,height] of [[320,568],[375,667],[390,664],[430,740],[768,900],[1440,900]]) for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width,height},colorScheme:theme});
   const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
   const writes=[];page.on('request',request=>{if(!['GET','HEAD'].includes(request.method()))writes.push(request.url());});
   await page.addInitScript(theme=>localStorage.setItem('opscenter.theme.v1',theme),theme);
   await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await page.goto(`${origin}/desktop-assets/tests/missing-punch.html`,{waitUntil:'networkidle'});
   await page.locator('.crew-week-day-summary').first().waitFor();
   const open=page.getByRole('button',{name:'Show all 7 days full screen for Sample Crew',exact:true});
   await open.click();
   const dialog=page.getByRole('dialog',{name:'Sample Crew full week',exact:true});
   await dialog.waitFor();
   assert.equal(await page.locator('html').getAttribute('data-ops-theme'),theme);
   const cards=dialog.locator('.crew-week-day');
   assert.equal(await cards.count(),7);
   assert.equal(await dialog.locator('.has-missing-punch').count(),3);
   for(const [i,label] of ['Missing clock-in','Missing clock-out','Missing clock-in and clock-out'].entries()){
    assert.equal(await cards.nth(i).locator('.crew-week-status').innerText(),label);
    assert.equal(await cards.nth(i).getAttribute('open'),null);
   }
   const colors=await cards.first().locator('summary').evaluate(el=>({ink:getComputedStyle(el.querySelector('.crew-week-status')).color,background:getComputedStyle(el).backgroundColor}));
   const lum=[luminance(colors.ink),luminance(colors.background)].sort((a,b)=>b-a);
   assert.ok((lum[0]+.05)/(lum[1]+.05)>=4.5,JSON.stringify({theme,colors}));
   assert.ok(theme==='dark'?luminance(colors.background)<.2:luminance(colors.background)>.5);
   const fit=await dialog.evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,width:el.clientWidth,scrollWidth:el.scrollWidth,rows:[...el.querySelectorAll('.crew-week-day-summary')].map(row=>{const r=row.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};})}));
   assert.ok(fit.scrollHeight<=fit.height+1 && fit.scrollWidth<=fit.width+1,JSON.stringify({name,width,height,theme,fit}));
   assert.ok(fit.rows.every(row=>row.top>=0&&row.bottom<=height&&row.left>=0&&row.right<=width&&row.height>=44),JSON.stringify({name,width,height,theme,fit}));
   await page.screenshot({path:`${evidence}/week-${name}-${width}x${height}-${theme}.png`});
   await cards.nth(1).locator('summary').click();
   assert.match(await cards.nth(1).innerText(),/Punch still missing/);
   assert.equal(await cards.nth(1).getByRole('button',{name:'Edit hours for Sample Crew on 2026-10-20',exact:true}).isVisible(),true);
   await cards.nth(1).locator('summary').click();
   await cards.nth(3).locator('summary').click();
   assert.match(await cards.nth(3).locator('.hours-day-grid').first().innerText(),/Clock Out\s+On shift/i);
   await cards.nth(3).locator('summary').click();
   await cards.nth(4).locator('summary').click();
   assert.match(await cards.nth(4).innerText(),/8:00 AM[\s\S]*4:00 PM/);
   await cards.nth(4).locator('summary').click();
   await dialog.getByRole('button',{name:'Next week',exact:true}).click();
   await dialog.getByText('Week 2 · Oct 26 – Nov 1',{exact:true}).waitFor();
   assert.equal(await dialog.locator('.crew-week-day').count(),7);
   assert.match(await dialog.locator('.crew-week-date').last().innerText(),/Sun\s+Nov 1/);
   await dialog.getByRole('button',{name:'Previous week',exact:true}).click();
   await dialog.getByText('Week 1 · Oct 19 – Oct 25',{exact:true}).waitFor();
   await dialog.press('Escape');
   await dialog.waitFor({state:'detached'});
   assert.equal(await open.evaluate(el=>el===document.activeElement),true,'Dismissal returns keyboard focus');
   await page.getByRole('button',{name:'Review issue for Sample Crew',exact:true}).click();
   assert.equal(await page.locator('output').innerText(),'Opened hours');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
   // Worst-case labels on every day must also fit the shortest supported phone.
   if(width===320){
    await page.goto(`${origin}/desktop-assets/tests/missing-punch.html?allMissing=1`,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Show all 7 days full screen for Sample Crew',exact:true}).click();
    const stress=page.getByRole('dialog');
    assert.equal(await stress.locator('.has-missing-punch').count(),7);
    assert.equal(await stress.evaluate(el=>el.scrollHeight<=el.clientHeight+1&&[...el.querySelectorAll('.crew-week-day-summary')].every(row=>row.getBoundingClientRect().bottom<=innerHeight)),true);
    await page.screenshot({path:`${evidence}/week-${name}-320-all-missing-${theme}.png`});
   }
   console.log(`${name} ${width}x${height} ${theme}: all 7 in viewport without scrolling, warning contrast, details, week navigation, Escape/focus, zero writes/errors PASS`);
   await page.close();
  }
 } finally {await browser.close();}
}
