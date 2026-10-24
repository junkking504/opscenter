import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const require=createRequire(new URL('../desktop-ui/package.json',import.meta.url));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const {default:react}=await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'opscenter-cost-vite-'));
const root=path.resolve('desktop-ui');
const server=await createServer({configFile:false,root,cacheDir:cache,plugins:[react()],resolve:{alias:{'@':root}},server:{host:'127.0.0.1',port:0}});
await server.listen();
const port=server.httpServer.address().port;
let browser;
try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 for(const width of [1440,1024,390,320]){
  await page.setViewportSize({width,height:1000});
  await page.goto(`http://127.0.0.1:${port}/tests/appointment-cost-incomplete.html`);
  const row=id=>page.getByTestId(id).locator('.register-attendance');
  await row('unquoted').waitFor();
  assert.match(await row('unquoted').innerText(),/\$149.00[\s\S]*To attend · subtotal[\s\S]*Missing: Current fuel price/);
  for(const id of ['quoted','paid'])assert.match(await row(id).innerText(),/\$292.50[\s\S]*Break-even · subtotal[\s\S]*Current fuel price/);
  assert.match(await row('unassigned').innerText(),/\$149.00/);
  assert.match(await row('route-missing').innerText(),/\$109.00[\s\S]*Route miles[\s\S]*Travel time[\s\S]*Crew hourly cost/);
  assert.doesNotMatch(await row('route-missing').innerText(),/Disposal|On-site/);
  assert.match(await row('disposal-only').innerText(),/\$275.00[\s\S]*Break-even/);
  assert.doesNotMatch(await row('disposal-only').innerText(),/subtotal/);
  assert.match(await row('disposal-only').getAttribute('title'),/Disposal/);
  assert.match(await row('complete').innerText(),/\$165.00/);
  assert.doesNotMatch(await row('complete').innerText(),/subtotal|Missing/);
  assert.doesNotMatch(await row('failed').innerText(),/\$/);
  assert.match(await row('refreshing').innerText(),/updating/);
  assert.match(await row('refresh-error').innerText(),/last estimate/);
  assert.match(await row('loading').innerText(),/Calculating/);
  assert.equal(await row('canceled').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}: no horizontal overflow`);
  for(const id of ['unquoted','quoted','route-missing']){
   const geometry=await row(id).evaluate(el=>{const box=el.getBoundingClientRect();return {width:box.width,children:[...el.children].map(c=>{const r=c.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}),right:box.right};});
   assert.ok(geometry.children.every(c=>c.right<=geometry.right+1),`${width}: contained cost text`);
   const [amount,label,missing]=geometry.children;
   assert.ok(amount.right<=label.x+1||amount.bottom<=label.y+1,`${width}: amount and label do not overlap`);
   assert.ok(missing.y>=Math.max(amount.bottom,label.bottom)-1,`${width}: missing inputs get their own line`);
  }
  await row('unquoted').click();
  assert.equal(await page.locator('output').innerText(),'Opened unquoted');
  const details=page.getByRole('region',{name:'Appointment minimum charge'});
  assert.match(await details.innerText(),/To attend subtotal: \$149.00/);
  assert.match(await details.innerText(),/Break-even subtotal incl. fees: \$292.50/);
  assert.match(await details.innerText(),/Stale; enter a current price/);
  assert.equal(await details.locator('header > strong').innerText(),'Unavailable');
  if(width===390||width===1440){
   await page.getByTestId('unquoted').screenshot({path:path.join(cache,`cost-${width}.png`)});
  }
 }
 console.log(`Synthetic cost cards/details passed at 320, 390, 1024 and 1440px. Screenshots: ${cache}`);
} finally {await browser?.close();await server.close();}
