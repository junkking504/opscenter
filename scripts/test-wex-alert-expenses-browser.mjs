import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {chromium} from 'playwright';
const require=createRequire(new URL('../desktop-ui/package.json',import.meta.url));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);const {default:react}=await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'wex-daily-ui-'));const root=path.resolve('desktop-ui');const server=await createServer({configFile:false,root,cacheDir:cache,plugins:[react()],resolve:{alias:{'@':root}},server:{host:'127.0.0.1',port:0}});await server.listen();let browser;
try{browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [320,390,1024,1440]){await page.setViewportSize({width,height:1000});await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/wex-alert-expenses.html`);await page.getByRole('heading',{name:'WEX daily alert records'}).waitFor();
  assert.equal(await page.locator('.finance-cost-list article').count(),4);assert.equal(await page.getByText('Authorization timezone unconfirmed',{exact:false}).count(),4);assert.ok((await page.locator('body').innerText()).includes('not added to published expenses'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
  await page.screenshot({path:path.join(cache,`daily-${width}.png`),fullPage:true});
 }assert.deepEqual(errors,[]);console.log(`Synthetic WEX daily UI passed at320/390/1024/1440; screenshots ${cache}`);
}finally{await browser?.close();await server.close();}
