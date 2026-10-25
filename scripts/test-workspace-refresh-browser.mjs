import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../desktop-ui/node_modules/vite/dist/node/index.js';
import { chromium } from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-refresh-hook-'));
const server=await createServer({configFile:path.join(root,'desktop-ui/vite.opscenter.config.ts'),configLoader:'runner',cacheDir:cache,base:'/',server:{host:'127.0.0.1',port:0}});
let browser;
try {
 await server.listen(); browser=await chromium.launch({headless:true});
 const page=await browser.newPage(), errors=[]; page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/workspace-refresh.html`);
 await page.waitForFunction(()=>JSON.parse(document.querySelector('#reader').textContent).error==='Synthetic poll failed');
 await page.evaluate(()=>{window.refreshTest.mode='ok';});
 await page.getByRole('button',{name:'Pull snapshot'}).click();
 await page.waitForFunction(()=>document.querySelector('#result').textContent==='Refreshed');
 let state=JSON.parse(await page.locator('#reader').innerText());
 assert.equal(state.error,''); assert.ok(state.receivedAt); assert.equal(state.pending,false); assert.equal(state.value,2);
 const receivedAt=state.receivedAt;
 // An existing poll is joined without a second read; own pending state must not abort the gesture.
 await page.evaluate(()=>{window.refreshTest.mode='hold';window.dispatchEvent(new Event('focus'));});
 await page.waitForFunction(()=>window.refreshTest.release.length===1);
 await page.getByRole('button',{name:'Pull snapshot'}).click();
 assert.equal(await page.evaluate(()=>window.refreshTest.calls),3);
 await page.evaluate(()=>window.refreshTest.release.splice(0).forEach(release=>release()));
 await page.waitForFunction(()=>document.querySelector('#result').textContent==='Refreshed');
 state=JSON.parse(await page.locator('#reader').innerText()); assert.equal(state.value,3); assert.ok(state.receivedAt>=receivedAt); assert.equal(state.error,'');
 // Cancellation of an explicitly owned read aborts it and preserves the last good metadata.
 const before=state;
 const cancelled=await page.evaluate(async()=>{const controller=new AbortController();const task=window.refreshTest.direct(controller.signal).then(()=>false,()=>true);controller.abort(new Error('Synthetic caller cancelled'));return task;});
 assert.equal(cancelled,true);
 await page.waitForFunction(()=>!JSON.parse(document.querySelector('#reader').textContent).pending);
 state=JSON.parse(await page.locator('#reader').innerText()); assert.equal(state.receivedAt,before.receivedAt); assert.equal(state.value,before.value); assert.equal(state.error,'');
 await page.evaluate(()=>{window.refreshTest.release.splice(0).forEach(release=>release());});
 // Editing cancels both registry and shared hook flights, without publishing a late result.
 await page.getByRole('button',{name:'Pull snapshot'}).click();
 await page.waitForFunction(()=>window.refreshTest.release.length===1);
 await page.getByRole('button',{name:'Toggle editing'}).click();
 await page.waitForFunction(()=>document.querySelector('#result').textContent==='Cancelled or failed');
 assert.equal(await page.getByRole('button',{name:'Pull snapshot'}).isDisabled(),true);
 assert.equal(await page.evaluate(async()=>{try{await window.refreshTest.direct(new AbortController().signal);return false;}catch{return true;}}),true);
 await page.evaluate(()=>{window.refreshTest.release.splice(0).forEach(release=>release());window.refreshTest.mode='ok';});
 await page.getByRole('button',{name:'Toggle editing'}).click();
 await page.waitForFunction(()=>!JSON.parse(document.querySelector('#reader').textContent).pending);
 await page.evaluate(()=>{window.refreshTest.mode='hold';});
 await page.getByRole('button',{name:'Pull snapshot'}).click();
 await page.waitForFunction(()=>window.refreshTest.release.length===1);
 await page.getByRole('button',{name:'Toggle mount'}).click();
 await page.waitForFunction(()=>document.querySelector('#result').textContent==='Cancelled or failed');
 assert.equal(await page.getByRole('button',{name:'Pull snapshot'}).isDisabled(),true);
 assert.ok(await page.evaluate(()=>window.refreshTest.aborts)>=3); assert.deepEqual(errors,[]);
 console.log('Workspace refresh hook passed: failed poll -> successful pull clears error/updates time, shared-flight dedup, no pending self-abort, caller cancellation, edit rejection/cancellation and unmount cleanup. In-memory only.');
} finally {await browser?.close();await server.close();fs.rmSync(cache,{recursive:true,force:true});}
