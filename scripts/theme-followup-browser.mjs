import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../desktop-ui/node_modules/vite/dist/node/index.js';
import { chromium, webkit } from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url));
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'theme-followup-'));
const output=process.env.THEME_FOLLOWUP_OUTPUT;
if(output)fs.mkdirSync(output,{recursive:true});
const server=await createServer({configFile:path.join(root,'desktop-ui/vite.opscenter.config.ts'),configLoader:'runner',cacheDir:cache,base:'/',server:{host:'127.0.0.1',port:0}});
const results=[];
try {
 await server.listen();
 for(const [engineName,engine] of Object.entries({chromium,webkit})){
  const browser=await engine.launch({headless:true});
  try{
   const lightWarnings=[];
   for(const [preference,osScheme] of [['dark','light'],['light','dark'],['light','light'],['system','dark'],['system','light']]){
    const page=await browser.newPage({viewport:{width:390,height:844},colorScheme:osScheme});
    const errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
     const url=new URL(route.request().url());
     if(url.hostname!=='127.0.0.1'||url.pathname.startsWith('/api/')){requests.push(url.pathname);return route.abort();}
     return route.continue();
    });
    await page.addInitScript(value=>localStorage.setItem('opscenter.theme.v1',value),preference);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/theme-followup.html`,{waitUntil:'networkidle'});
    const theme=preference==='system'?osScheme:preference;
    assert.equal(await page.locator('html').getAttribute('data-ops-theme'),theme);
    const metrics=await page.evaluate(()=>{
     const lum=rgb=>rgb.map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,i)=>sum+value*[.2126,.7152,.0722][i],0);
     const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
     const color=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
     const mix=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]/255+b[i]*(1-a[3]/255));
     const ids=['primary','outline','destructive','brand','fleet-service','fleet-disabled','ready','attention','stop','warn-badge','finance-warning','finance-status','closeout'];
     return Object.fromEntries(ids.map(id=>{const e=document.getElementById(id),s=getComputedStyle(e),chain=[];for(let node=e;node;node=node.parentElement)chain.push(color(getComputedStyle(node).backgroundColor));let bg=[255,255,255];for(const c of chain.reverse())bg=mix(c,bg);const fg=mix(color(s.color),bg),a=lum(fg),b=lum(bg);return[id,{color:s.color,background:s.backgroundColor,border:s.borderLeftColor,opacity:s.opacity,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}];}));
    });
    for(const id of ['primary','outline','destructive','brand','fleet-service','ready','attention','stop','warn-badge','finance-warning','finance-status','closeout'])assert.ok(metrics[id].contrast>=4.5,`${engineName}/${preference}/${osScheme} ${id} contrast ${metrics[id].contrast}`);
    assert.notEqual(metrics.primary.background,metrics.outline.background);
    assert.notEqual(metrics.destructive.color,metrics.outline.color);
    assert.notEqual(metrics.ready.color,metrics.attention.color);
    assert.notEqual(metrics.stop.color,metrics.attention.color);
    assert.equal(await page.locator('#fleet-disabled').isDisabled(),true);
    assert.ok(Number(metrics['fleet-disabled'].opacity)<1);
    if(theme==='light')lightWarnings.push(metrics['finance-warning']);
    if(output)await page.screenshot({path:path.join(output,`${engineName}-${preference}-${osScheme}-components-after.png`),fullPage:true});
    await page.locator('#hint-trigger').focus();
    await page.getByRole('tooltip').waitFor();
    assert.equal(await page.getByRole('tooltip').evaluate(e=>e.parentElement===document.body),true,'Actual hint uses the body portal');
    const hint=await page.getByRole('tooltip').evaluate(e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor,text:e.textContent}));
    assert.equal(hint.text,'Open the related record');
    assert.notEqual(hint.color,hint.background);
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    results.push({engineName,preference,osScheme,theme,metrics,hint});await page.close();
   }
   assert.deepEqual(lightWarnings[0],lightWarnings[1],'Explicit Light overrides OS dark for statement warnings');
  }finally{await browser.close();}
 }
 if(output)fs.writeFileSync(path.join(output,'theme-regression-results.json'),JSON.stringify(results,null,2));
 console.log('Theme follow-up: Chromium/WebKit × five Light/Dark/System combinations pass: brand/destructive/secondary roles, status distinctions, enabled-control contrast, disabled state, OS override and actual hint portal; no API/external requests.');
}finally{await server.close();fs.rmSync(cache,{recursive:true,force:true});}
