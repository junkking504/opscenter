import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.env.UI_SAFE_EVIDENCE || '/tmp/ui-safe-display-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
function luminance(rgb) {
  const values = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;});
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}
for (const theme of ['light', 'dark']) for (const width of [1440, 390]) for (const [workspace, label] of [['Command','Dashboard'],['Schedule','Command'],['Krewe','Krewe'],['Fleet','Fleet'],['Finance','Finance'],['Marketing','Marketing']]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({time:new Date('2026-10-09T18:00:00Z')});
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.fulfill({status:204}));
  await page.goto(`http://127.0.0.1:3158/desktop-assets/tests/aspect-ratio.html?workspace=${workspace}&commandMap=1&copyQA=1`);
  await page.waitForSelector('.workspace');
  await page.evaluate(theme => {document.documentElement.setAttribute('data-ops-theme',theme);}, theme);
  await page.waitForTimeout(800);
  const result = await page.evaluate(() => {
    const visible = el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden';
    const samples = [...document.querySelectorAll('.missing-value,.workspace-page-link:not([aria-current="page"]),.workspace-rail-link:not(.active)')].filter(visible).map(el => {
      let parent=el; let background='rgba(0, 0, 0, 0)';
      while(parent) {background=getComputedStyle(parent).backgroundColor;if(background!=='rgba(0, 0, 0, 0)')break;parent=parent.parentElement;}
      return {text:el.textContent,color:getComputedStyle(el).color,background};
    });
    return {overflow:document.documentElement.scrollWidth > innerWidth, samples,
      missing:[...document.querySelectorAll('.missing-value:has(.missing-value-label)')].filter(visible).map(el=>({text:el.textContent,width:el.getBoundingClientRect().width})),
      unlabeled:[...document.querySelectorAll('button,input,select,textarea')].filter(visible).filter(el=>!el.textContent.trim()&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')&&!el.getAttribute('title')&&!el.getAttribute('placeholder')&&!el.labels?.length).map(el=>el.outerHTML.slice(0,200))};
  });
  result.samples=result.samples.map(sample=>{const a=luminance(sample.color),b=luminance(sample.background);return {...sample,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
  await page.screenshot({path:`${output}/${label}-${width}-${theme}.png`,fullPage:true});
  results.push({label,width,theme,...result,errors});
  console.log(JSON.stringify({label,width,theme,overflow:result.overflow,unlabeled:result.unlabeled,minimumContrast:Math.min(...result.samples.map(s=>s.ratio)),errors}));
  await page.close();
}
await browser.close();
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));
assert.ok(results.every(r=>!r.overflow), 'No page overflow');
assert.ok(results.every(r=>r.samples.every(s=>s.ratio>=4.5)), 'Secondary navigation and missing text meet 4.5:1');
assert.ok(results.every(r=>!r.errors.length), 'No browser runtime errors');
assert.ok(results.every(r=>!r.unlabeled.length), 'Visible controls have labels');
