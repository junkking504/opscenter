import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1280,height:720}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.fulfill({status:204}));
await page.goto('http://127.0.0.1:3158/tests/aspect-ratio.html?workspace=Command&date=2026-09-12');
await page.waitForSelector('.workspace-rail-link');
assert.equal(await page.locator('.workspace-rail-link').count(),6);
const targets=await page.locator('.workspace-rail-page').evaluateAll(links=>links.filter(link=>!link.href.includes('tv=1')).map(link=>{const url=new URL(link.href);const workspace=url.searchParams.get('workspace');const key={Command:'commandView',Schedule:'scheduleView',Krewe:'kreweView',Fleet:'fleetView',Finance:'financeView',Marketing:'marketingView'}[workspace];return {workspace,key,area:url.searchParams.get(key),label:link.textContent};}));
assert.equal(targets.length,25);
for(const target of targets){
 const button=page.locator(`[aria-controls="workspace-menu-${target.workspace}"]`);
 const before=page.url();
 if(await button.getAttribute('aria-expanded')!=='true')await button.click();
 assert.equal(page.url(),before,'Opening a workspace menu must not navigate');
 await page.locator(`#workspace-menu-${target.workspace}`).getByRole('link',{name:target.label,exact:true}).click();
 await page.waitForFunction(({workspace,key,area})=>{const url=new URL(location.href);return url.searchParams.get('workspace')===workspace&&url.searchParams.get(key)===area;},target);
 assert.equal(new URL(page.url()).searchParams.get('date'),'2026-09-12');
 assert.equal(await page.locator('.workspace-rail-page[aria-current="page"]').count(),1);
 assert.equal(await button.getAttribute('aria-current'),'location');
 assert.equal(await button.getAttribute('aria-expanded'),'false');
 console.log(`Direct area reached: ${target.workspace} / ${target.label}`);
}
// Capital combines its summary and trends while old trend links remain usable.
await page.goto('http://127.0.0.1:3158/tests/aspect-ratio.html?workspace=Finance&financeView=overview');
await page.waitForSelector('#capital-trends .finance-performance');
assert.equal(await page.locator('.capital-hub').count(),1);
assert.equal(await page.getByRole('tab',{name:'Trends',exact:true}).count(),0);
assert.equal(await page.locator('.page-rail').getByRole('link',{name:'Trends',exact:true}).count(),0);
assert.equal(await page.locator('.page-rail').getByRole('link',{name:'Reconciliation',exact:true}).count(),0);
await page.locator('#capital-trends').getByRole('combobox',{name:/^Period/}).selectOption('ytd');
assert.equal(await page.locator('#capital-trends').getByRole('combobox',{name:/^Period/}).inputValue(),'ytd');
await page.locator('.capital-metric-primary').click();
await page.waitForFunction(()=>new URL(location.href).searchParams.get('financeView')==='trends');
await page.waitForFunction(()=>Math.abs(document.getElementById('capital-trends').getBoundingClientRect().top)<3);
assert.equal(await page.locator('.capital-hub').count(),1);
await page.goto('http://127.0.0.1:3158/tests/aspect-ratio.html?workspace=Finance&financeView=trends');
await page.waitForSelector('#capital-trends .finance-performance');
assert.equal(await page.getByRole('tab',{name:'Overview',exact:true}).getAttribute('aria-selected'),'true');
assert.equal(await page.locator('.workspace-rail-page[aria-current="page"]').innerText(),'Overview');
assert.equal(await page.locator('.capital-hub').count(),1);
await page.waitForFunction(()=>Math.abs(document.getElementById('capital-trends').getBoundingClientRect().top)<3);
console.log('Capital Overview contains trends; controls and legacy links work.');

const command=page.getByRole('button',{name:'Command',exact:true});
await command.focus();await page.keyboard.press('ArrowRight');
assert.equal(await page.locator('#workspace-menu-Command').getByRole('link',{name:'Updates',exact:true}).evaluate(e=>e===document.activeElement),true);
await page.keyboard.press('Escape');
assert.equal(await command.evaluate(e=>e===document.activeElement),true);
assert.equal(await command.getAttribute('aria-expanded'),'false');
await command.click();
const tv=await page.locator('#workspace-menu-Command').getByRole('link',{name:'The Huddle',exact:true}).getAttribute('href');
assert.equal(new URL(tv,page.url()).searchParams.get('tv'),'1');
assert.equal(new URL(tv,page.url()).searchParams.has('date'),false);
await page.getByRole('heading',{level:1}).click();
assert.equal(await command.getAttribute('aria-expanded'),'false');
for(const [width,height]of [[1280,720],[1024,480],[390,844]]){
 await page.setViewportSize({width,height});
 const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,rail:document.querySelector('.ops-sidebar').getBoundingClientRect().width,footer:document.querySelector('.sidebar-footer').getBoundingClientRect().bottom}));
 assert.equal(geometry.overflow,false);assert.equal(geometry.rail,width>760?80:0);
 if(width>760)assert.ok(geometry.footer<=height,'Source Health remains reachable');
 else assert.equal(await page.getByRole('combobox',{name:'Choose workspace'}).isVisible(),true);
}
assert.deepEqual(errors,[]);
await browser.close();console.log('Workspace menus, direct areas, historical date, keyboard and responsive navigation passed.');
