import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const origin=process.env.KREWE_PREVIEW_URL || 'http://127.0.0.1:3297';
const browser=await chromium.launch({headless:true});
try {
 for(const width of (process.env.KREWE_WIDTH ? [Number(process.env.KREWE_WIDTH)] : [390,1440])) for(const theme of (process.env.KREWE_THEME ? [process.env.KREWE_THEME] : ['light','dark'])) for(const role of (process.env.KREWE_ROLE ? [process.env.KREWE_ROLE] : ['Operator','Manager'])) {
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme});
  page.setDefaultTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(theme=>{localStorage.setItem('opscenter.theme.v1',theme);},theme);
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(`${origin}/desktop-assets/tests/krewe-simplify.html?workspace=Krewe&kreweView=today&testRole=${role}`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.locator('.crew-today-row').first().waitFor();
  assert.match(await page.locator('.topbar-actions').innerText(),new RegExp(`Signed in as Sample User \\(${role}\\)`));
  assert.equal(await page.locator('.workspace-heading h1').innerText(),'Today');
  assert.equal(await page.locator('.krewe-purpose').isVisible(),true);
  assert.equal(await page.locator('.krewe-signed-in').isVisible(),true);
  assert.equal(await page.locator('html').getAttribute('data-ops-theme'),theme);
  const meters=page.locator('.krewe-week-meter');assert.equal(await meters.count(),6);
  if(role==='Manager') {
   await page.locator('.krewe-week-meter[data-tone="overtime"]').waitFor();
   assert.equal(await page.locator('.krewe-week-meter[data-tone="warning"]').count(),2);
   assert.equal(await page.locator('.krewe-week-meter[data-tone="overtime"]').count(),1);
   assert.equal(await page.locator('.krewe-week-meter[data-tone="missing"]').count(),1);
  } else {
   assert.equal(await page.locator('.crew-today-fact.crew-today-pay').count(),0);
   assert.equal(await page.locator('.krewe-week-meter[data-tone="missing"]').count(),6);
   await page.getByRole('button',{name:'View record for Sample Normal',exact:true}).click();
   assert.equal(await page.locator('.crew-record-pay').count(),0);
   assert.doesNotMatch(await page.getByRole('dialog').innerText(),/157\.23|12\.34|19\.87|189\.44|19\.63/);
   await page.getByRole('button',{name:'Close Krewe record',exact:true}).click();
  }
  for(const view of ['Pay Period','Monthly','Leaderboard']) {
   await page.getByRole('tab',{name:role==='Operator'?new RegExp(`^${view}.*Managers`):view,exact:role!=='Operator'}).click();
   if(role==='Operator') {await page.getByRole('heading',{name:'Managers Only',exact:true}).waitFor();assert.equal(await page.locator('.live-krewe,.krewe-leaderboard').count(),0);}
   else if(view==='Leaderboard') {
    await page.getByRole('list',{name:'Rankings',exact:true}).waitFor();
    assert.equal(await page.locator('.krewe-leaderboard li').count(),4);
    assert.doesNotMatch(await page.locator('.krewe-leaderboard ol').innerText(),/Sample Short|Sample Missing/);
    await page.getByRole('combobox',{name:'Leaderboard Period',exact:true}).selectOption('today');
    await page.waitForFunction(()=>document.querySelectorAll('.krewe-leaderboard li').length===2);
    await page.getByRole('combobox',{name:'Leaderboard Measure',exact:true}).selectOption('jobs');
    assert.equal(await page.getByRole('option',{name:'Reviews Credited'}).count(),0);
    await page.getByRole('combobox',{name:'Leaderboard Period',exact:true}).selectOption('month');
    await page.waitForFunction(()=>document.querySelectorAll('.krewe-leaderboard li').length===4);
    await page.getByRole('combobox',{name:'Leaderboard Measure',exact:true}).selectOption('driving');
   } else if(view==='Pay Period') {
    await page.getByRole('list',{name:'Pay Period Checklist'}).waitFor();
    assert.match(await page.locator('.payroll-checklist').innerText(),/Review Hours[\s\S]*Resolve Flags[\s\S]*Export[\s\S]*Email Managers[\s\S]*Not Prepared/);
    await page.getByRole('button',{name:'Payroll review',exact:true}).click();
    const download=page.waitForEvent('download');await page.getByRole('button',{name:/Export draft/}).click();await download;
    assert.match(await page.locator('.payroll-checklist').innerText(),/Draft Export Downloaded/);
   } else { await page.locator('.krewe-monthly-shell').waitFor(); }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${role} ${view} ${width} ${theme}: page fits`);
  }
  if(role==='Operator') assert.ok((await page.evaluate(()=>window.kreweReads)).every(url=>!url.includes('view=payperiod')&&!url.includes('view=monthly')&&!url.includes('/hours')),'Locked views must never request payroll');
  await page.screenshot({path:`/tmp/krewe-${role}-${theme}-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${role} ${theme} ${width}px: Today, payroll locks, checklist, leaderboard and overflow`);
 }
} finally {await browser.close();}
