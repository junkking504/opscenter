import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from '../desktop-ui/node_modules/vite/dist/node/index.js';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'completed-display-'));
const server=await createServer({configFile:path.join(root,'desktop-ui/tests/schedule-destinations.vite.config.ts'),configLoader:'runner',cacheDir:cache,base:'/',server:{host:'127.0.0.1',port:0}});
let browser;
try {
 await server.listen();browser=await chromium.launch({headless:true});
 for(const width of [390,1440]) {
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/schedule-destinations.html?scenario=gps-mismatch&fullShell=1`);
  const row=page.getByRole('row').filter({hasText:'JK1001001'}).last();await row.waitFor({state:'attached',timeout:20000});
  assert.match(await row.innerText(),/33 min on site[\s\S]*Started 9:06 AM · Finished 9:38 AM/);
  assert.doesNotMatch(await row.innerText(),/1 min on site|8:28 AM|8:29 AM/);
  const block=page.locator('[data-schedule-appointment]').first();
  await block.click();
  const summary=width<700?page.locator('.appointment-summary-dialog'):page.getByRole('region',{name:'Selected job JK1001001',exact:true});await summary.waitFor({timeout:20000});
  if(width>=700) assert.match(await summary.innerText(),/Started 9:06 AM · Finished 9:38 AM/);
  else assert.match(await summary.innerText(),/Truck# 3[\s\S]*GPS confirmed · JunkWare says Truck# 6/);
  assert.doesNotMatch(await summary.innerText(),/8:28 AM|8:29 AM/);
  assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  assert.deepEqual(errors,[]);
  const output=process.env.DISPLAY_SCREENSHOTS;if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,`completed-display-${width}.png`),fullPage:true});}
  console.log(`PASS completed display ${width}: resolved register time and responsive summary evidence, zero writes`);
  await page.close();
 }
}finally{await browser?.close();await server.close();fs.rmSync(cache,{recursive:true,force:true});}
