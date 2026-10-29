import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../desktop-ui/node_modules/vite/dist/node/index.js';
import { chromium } from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'schedule-refresh-race-'));
const server=await createServer({configFile:path.join(root,'desktop-ui/tests/schedule-destinations.vite.config.ts'),configLoader:'runner',cacheDir:cache,base:'/',server:{host:'127.0.0.1',port:0,strictPort:false}});
let browser;
try {
 await server.listen(); browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/schedule-refresh-race.html`);
 await page.locator('.schedule-board').waitFor();
 await page.waitForTimeout(300);
 await page.evaluate(()=>{
  const original=window.fetch;
  window.race={mode:'hold-poll',releases:[],displayReads:0};
  window.fetch=async(input,init)=>{
   const url=new URL(String(input),location.origin),state=window.race;
   if(url.pathname!=='/api/desktop/schedule')return original(input,init);
   const display=url.searchParams.get('displayOnly')==='1';
   if(display)state.displayReads++;
   const body=await (await original(input,init)).json();
   for(const job of body.appointments)job.jkNumber=display?'DISPLAY-FRESH':'POLL-FRESH';
   if((state.mode==='hold-poll'&&!display)||(state.mode==='hold-display'&&display)){
    if(display)for(const job of body.appointments)job.jkNumber='DISPLAY-OLD';
    return new Promise(resolve=>state.releases.push(()=>resolve(Response.json(body))));
   }
   return Response.json(body);
  };
  document.dispatchEvent(new Event('visibilitychange'));
 });
 await page.waitForFunction(()=>window.race.releases.length===2);
 await page.getByRole('button',{name:'Read displayed snapshot'}).click();
 await page.waitForFunction(()=>document.querySelector('#refresh-result').textContent.includes('snapshot read'));
 assert.equal(await page.evaluate(()=>window.race.displayReads),0,'pull rejects while ordinary poll is pending');
 await page.evaluate(()=>{window.race.mode='normal';window.race.releases.splice(0).forEach(release=>release());});
 await page.getByText('POLL-FRESH',{exact:true}).first().waitFor();
 await page.waitForTimeout(100);
 await page.evaluate(()=>{window.race.mode='hold-display';});
 await page.getByRole('button',{name:'Read displayed snapshot'}).click();
 await page.waitForFunction(()=>window.race.releases.length===1);
 await page.evaluate(()=>{window.race.mode='normal';document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(200);
 await page.evaluate(()=>window.race.releases.splice(0).forEach(release=>release()));
 await page.waitForFunction(()=>document.querySelector('#refresh-result').textContent.includes('newer schedule read'));
 assert.equal(await page.getByText('DISPLAY-OLD',{exact:true}).count(),0,'late pull never replaces newer poll');
 assert.ok(await page.getByText('POLL-FRESH',{exact:true}).count()>0);
 await page.getByRole('button',{name:'Read displayed snapshot'}).click();
 await page.waitForFunction(()=>document.querySelector('#refresh-result').textContent==='Refreshed');
 assert.ok(await page.getByText('DISPLAY-FRESH',{exact:true}).count()>0,'idle pull publishes snapshot');
 assert.match(await page.locator('#fixture-writes').innerText(),/^Writes: 0/);
 assert.deepEqual(errors,[]);
 console.log('Schedule refresh race passed: pending-poll rejection, late-display suppression, successful idle pull, no writes or page errors. Synthetic requests only.');
} finally {await browser?.close();await server.close();fs.rmSync(cache,{recursive:true,force:true});}
