import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const output=process.env.NEUTRAL_CAPTURE_DIR || 'tmp/neutral-shell';
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const receipts=[];
try {
for(const [label,workspace] of [['Dashboard','Command'],['Command','Schedule'],['Krewe','Krewe'],['Fleet','Fleet'],['Finance','Finance'],['Marketing','Marketing']]) for(const width of [1440,390]) for(const theme of ['light','dark']) {
 const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme});
 page.setDefaultTimeout(120_000);page.setDefaultNavigationTimeout(120_000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(theme=>localStorage.setItem('opscenter.theme.v1',theme),theme);
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.fulfill({status:204}));
 await page.goto(`${process.env.DESKTOP_TEST_ORIGIN||'http://127.0.0.1:3158'}/tests/aspect-ratio.html?workspace=${workspace}&commandMap=1`,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('.ops-content .workspace');await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(800);
 const handle=await page.waitForFunction(()=>{
  const app=document.querySelector('.ops-app'),content=document.querySelector('.ops-content'),tab=document.querySelector('.shared-workspace-tabs > .active');
  if(!app||!content)return false;
  const style=getComputedStyle(content),probe=document.createElement('span');content.append(probe);
  const resolve=name=>{probe.style.color=`var(${name})`;return getComputedStyle(probe).color.match(/[\d.]+/g).slice(0,3).map(Number);};
  const colors=Object.fromEntries(['--oc-text-primary','--oc-text-muted','--oc-surface-raised','--oc-surface-canvas'].map(name=>[name,resolve(name)]));probe.remove();
  const t=tab&&getComputedStyle(tab);
  return {theme:document.documentElement.dataset.opsTheme,overflow:document.documentElement.scrollWidth>innerWidth,icons:app.querySelectorAll('.workspace-rail-icon,.workspace-page-list,.workspace-group-toggle').length,colors,tab:t&&{background:t.backgroundColor,border:t.borderBottomColor,radius:t.borderRadius},active:app.querySelector('.workspace-rail-link.active')?.getAttribute('aria-current'),railRows:[...app.querySelectorAll('.page-rail > .workspace-rail-group')].map(e=>e.getBoundingClientRect().y),contentBackground:style.backgroundColor};
 });
 const result=await handle.jsonValue();await handle.dispose();
 assert.equal(result.theme,theme);assert.equal(result.overflow,false,`${label}/${width}/${theme} overflow`);assert.equal(result.icons,0);assert.equal(result.active,'page');
 if(width>760)for(let i=1;i<result.railRows.length;i++)assert.ok(result.railRows[i]-result.railRows[i-1]<=52,'Flat sidebar rows stay together');
 if(result.tab){assert.equal(result.tab.radius,'0px');assert.equal(result.tab.background,'rgba(0, 0, 0, 0)');}
 for(const ink of ['--oc-text-primary','--oc-text-muted'])for(const surface of ['--oc-surface-raised','--oc-surface-canvas'])assert.ok(contrast(result.colors[ink],result.colors[surface])>=4.5,`${label}/${theme}: ${ink} on ${surface}`);
 assert.deepEqual(errors,[]);
 const file=`${label}-${width}-${theme}.png`;await page.screenshot({path:`${output}/${file}`});receipts.push({fixture:true,label,workspace,width,height:900,theme,file,...result});
 await page.close();console.log(`${label} ${width} ${theme}: shell, contrast and screenshot passed`);
}
}finally{await browser.close();}
fs.writeFileSync(`${output}/receipts.json`,JSON.stringify(receipts,null,2)+'\n');
fs.writeFileSync(`${output}/index.html`,'<!doctype html><title>Neutral shell synthetic fixtures</title><h1>Synthetic fixtures — not the live app</h1><p>Approved mockup files and artifact links were unavailable. Side-by-side mockup acceptance remains pending.</p>'+receipts.map(r=>`<h2>${r.label} ${r.width} ${r.theme}</h2><img style="max-width:100%" src="${r.file}" alt="${r.label} synthetic fixture">`).join(''));
