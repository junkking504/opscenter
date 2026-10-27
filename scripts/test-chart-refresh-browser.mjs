import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../desktop-ui/node_modules/vite/dist/node/index.js';
import { chromium, webkit } from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'chart-refresh-'));
const server=await createServer({configFile:path.join(root,'desktop-ui/vite.opscenter.config.ts'),configLoader:'runner',cacheDir:cache,base:'/',server:{host:'127.0.0.1',port:0}});
try {
 await server.listen();
 for (const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]) {
  const browser=await engine.launch({headless:true});
  try {
   const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],network=[];
   page.on('pageerror',error=>errors.push(error.message));
   page.on('request',request=>{if(request.url().includes('/api/'))network.push(request.url());});
   await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/chart-refresh.html`);
   const pull=page.getByRole('button',{name:'Pull snapshot'});
   const complete=()=>page.waitForFunction(()=>document.querySelector('#result').textContent==='Refreshed');
   const release=()=>page.evaluate(()=>window.chartRefreshTest.release.splice(0).forEach(resolve=>resolve()));
   const configure=(mode,value)=>page.evaluate(({mode,value})=>{window.chartRefreshTest.mode=mode;if(value!==undefined)window.chartRefreshTest.value=value;},{mode,value});
   const calls=()=>page.evaluate(()=>window.chartRefreshTest.requests.length);
   await page.waitForFunction(()=>window.chartRefreshTest.requests.length===1);
   await pull.click();
   await pull.click();
   assert.equal(await calls(),1,'Initial chart read and repeated pulls share one flight');
   await release(); await complete();
   assert.match(await page.locator('.operating-inspected-values').innerText(),/\$100\.00/);
   await configure('ok',250); await pull.click(); await complete();
   assert.match(await page.locator('.operating-inspected-values').innerText(),/\$250\.00/);
   await page.getByText('View daily values & source',{exact:true}).click();
   assert.equal(await page.locator('.operating-data-table tr').filter({hasText:'2026-10-23'}).locator('td').nth(1).innerText(),'$0.00');
   assert.equal(await page.locator('.operating-data-table tr').filter({hasText:'2026-10-22'}).locator('td').nth(1).innerText(),'—');
   await configure('fail'); await pull.click();
   await page.waitForFunction(()=>document.querySelector('#result').textContent==='Cancelled or failed');
   assert.match(await page.locator('[role=status]').innerText(),/Synthetic chart read failed.*previous chart data/);
   assert.match(await page.locator('.operating-inspected-values').innerText(),/\$250\.00/);
   await configure('hold',300);
   await page.getByRole('button',{name:'Refresh charts',exact:true}).click();
   await page.waitForFunction(()=>window.chartRefreshTest.release.length===1);
   const before=await calls(); await pull.click();
   assert.equal(await calls(),before,'Manual button and pull share one flight');
   await release(); await complete();
   assert.match(await page.locator('.operating-inspected-values').innerText(),/\$300\.00/);
   assert.equal(await page.getByText('Synthetic chart read failed',{exact:false}).count(),0);
   // Date changes abort pending old reads and the registry promise. Old completion cannot win.
   await configure('hold',999); await pull.click();
   await page.waitForFunction(()=>window.chartRefreshTest.release.length===1);
   await configure('ok',400); await page.getByRole('button',{name:'Change date'}).click();
   await page.waitForFunction(()=>document.querySelector('#result').textContent==='Cancelled or failed');
   await page.waitForFunction(()=>document.querySelector('.operating-inspected-values')?.textContent.includes('$400.00'));
   await release();
   assert.doesNotMatch(await page.locator('.operating-inspected-values').innerText(),/999/);
   assert.ok((await page.evaluate(()=>window.chartRefreshTest.requests.at(-1).url)).includes('date=2026-10-24'));
   // Scope changes have the same cancellation boundary and fetch the new scope.
   await configure('hold',998); await pull.click();
   await page.waitForFunction(()=>window.chartRefreshTest.release.length===1);
   await configure('ok',500); await page.getByRole('button',{name:'Change scope'}).click();
   await page.waitForFunction(()=>document.querySelector('#result').textContent==='Cancelled or failed');
   await page.waitForFunction(()=>document.querySelector('.operating-chart-latest')?.textContent.includes('$500.00'));
   await release();
   assert.doesNotMatch(await page.locator('.operating-chart-latest').innerText(),/998/);
   assert.ok((await page.evaluate(()=>window.chartRefreshTest.requests.at(-1).url)).includes('scope=business'));
   await configure('hold',997); await pull.click();
   await page.waitForFunction(()=>window.chartRefreshTest.release.length===1);
   await page.getByRole('button',{name:'Toggle mount'}).click();
   await page.waitForFunction(()=>document.querySelector('#result').textContent==='Cancelled or failed');
   assert.equal(await pull.isDisabled(),true); await release();
   await configure('null'); await page.getByRole('button',{name:'Toggle mount'}).click();
   await page.getByText('Historical chart data is unavailable. Waiting for the prediction dataset refresh.').waitFor();
   assert.ok(await page.evaluate(()=>window.chartRefreshTest.aborts)>=3);
   assert.deepEqual(await page.evaluate(()=>[...new Set(window.chartRefreshTest.requests.map(request=>request.method))]),['GET']);
   assert.deepEqual(network,[],'All analytics requests intercepted in memory; no provider/API network calls');
   assert.deepEqual(errors,[]);
   console.log(`${name}: chart refresh passed initial/manual/pull dedup, changed values, failure retention, date/scope cancellation, unmount, null availability, GET-only boundary.`);
  } finally {await browser.close();}
 }
} finally {await server.close();fs.rmSync(cache,{recursive:true,force:true});}
