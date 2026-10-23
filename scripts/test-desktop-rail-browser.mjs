import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1280,height:720}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.fulfill({status:204}));
const origin=process.env.DESKTOP_TEST_ORIGIN || 'http://127.0.0.1:3158';
const fixture=`${origin}/tests/aspect-ratio.html`;
await page.goto(`${fixture}?workspace=Command&date=2026-09-12`);
await page.waitForSelector('.workspace-rail-link');
assert.equal(await page.locator('.workspace-rail-link').count(),7);
assert.equal(await page.locator('.workspace-rail-flyout').count(),0);
await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
const targets=[['Dashboard','Command','commandView','now'],['Command','Schedule','scheduleView','board'],['Krewe','Krewe','kreweView','today'],['Fleet','Fleet','fleetView','overview'],['Finance','Finance','financeView','overview'],['Marketing','Marketing','marketingView','overview'],['Settings','Settings',null,null]];
for(const [label,workspace,key,area] of targets){
 const link=page.locator('.ops-sidebar').getByRole('link',{name:label,exact:true});
 await link.click();
 await page.waitForFunction(({workspace,key,area})=>{const url=new URL(location.href);return url.searchParams.get('workspace')===workspace&&(!key||url.searchParams.get(key)===area);},{workspace,key,area});
 assert.equal(new URL(page.url()).searchParams.get('date'),'2026-09-12');
 assert.equal(await page.locator('.workspace-rail-link[aria-current="page"]').count(),1);
 assert.equal(await link.getAttribute('aria-current'),'page');
 assert.equal(await link.getAttribute('aria-expanded'),null);
 console.log(`One click reached: ${label}`);
}
// Neither panel expansion nor changing its section moves the page or rail rows.
const geometryOf = () => ({content:document.querySelector('.ops-content').getBoundingClientRect().toJSON(),rows:[...document.querySelectorAll('.workspace-rail-link')].map(el=>el.getBoundingClientRect().toJSON())});
const settingsUrl=page.url(), fixedGeometry=await page.evaluate(geometryOf);
const openSection = async name => { const box=await page.getByRole('button',{name,exact:true}).boundingBox(); assert.ok(box); await page.mouse.click(box.x+box.width/2,box.y+box.height/2); };
await openSection('Show Command pages');
assert.equal(page.url(),settingsUrl);
assert.deepEqual(await page.evaluate(geometryOf),fixedGeometry);
await openSection('Show Finance pages');
assert.deepEqual(await page.evaluate(geometryOf),fixedGeometry);
await openSection('Show Command pages');
await page.locator('.sidebar-page-panel').getByRole('link',{name:'Calendar',exact:true}).press('Enter');
await page.waitForFunction(()=>new URL(location.href).searchParams.get('scheduleView')==='calendar');
assert.equal(new URL(page.url()).searchParams.get('date'),'2026-09-12');
assert.equal(await page.getByRole('tab',{name:'Calendar',exact:true}).getAttribute('aria-selected'),'true');
assert.equal(await page.locator('.sidebar-page-panel').count(),0);
await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
await page.getByRole('button',{name:'Close page panel',exact:true}).press('Escape');
assert.equal(await page.locator('.sidebar-page-panel').count(),0);
assert.equal(await page.getByRole('button',{name:'Expand sidebar',exact:true}).evaluate(el=>el===document.activeElement),true);
await page.reload();
await page.getByRole('button',{name:'Expand sidebar',exact:true}).waitFor();
await page.locator('.ops-sidebar').getByRole('link',{name:'Settings',exact:true}).click();
await page.getByLabel('Default opening page').selectOption('Fleet');
await page.getByText('Saved for this browser.',{exact:true}).waitFor();
await page.goto(`${fixture}?scheduleDay=today`);
await page.getByRole('heading',{name:'Fleet',exact:true,level:1}).waitFor();
await page.goto(`${fixture}?workspace=Schedule&scheduleView=calendar&date=2026-09-12`);
await page.getByRole('tab',{name:'Calendar',exact:true}).waitFor();
assert.equal(await page.getByRole('tab',{name:'Calendar',exact:true}).getAttribute('aria-selected'),'true');
await page.locator('.ops-sidebar').getByRole('link',{name:'Command',exact:true}).click();
await page.waitForFunction(()=>new URL(location.href).searchParams.get('scheduleView')==='board');
// Clicking a workspace again returns from a subpage to its main page.
await page.getByRole('tab',{name:'Calendar',exact:true}).click();
await page.locator('.ops-sidebar').getByRole('link',{name:'Command',exact:true}).press('Enter');
await page.waitForFunction(()=>new URL(location.href).searchParams.get('scheduleView')==='board');
// Capital combines its summary and trends while old trend links remain usable.
await page.goto(`${fixture}?workspace=Finance&financeView=overview`);
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
await page.goto(`${fixture}?workspace=Finance&financeView=trends`);
await page.waitForSelector('#capital-trends .finance-performance');
assert.equal(await page.getByRole('tab',{name:'Overview',exact:true}).getAttribute('aria-selected'),'true');
assert.equal(await page.locator('.workspace-rail-link[aria-current="page"]').innerText(),'Finance');
assert.equal(await page.locator('.capital-hub').count(),1);
await page.waitForFunction(()=>Math.abs(document.getElementById('capital-trends').getBoundingClientRect().top)<3);
console.log('Capital Overview contains trends; controls and legacy links work.');

await page.locator('.ops-sidebar').getByRole('link',{name:'Settings',exact:true}).click();
await page.getByRole('heading',{name:'My Preferences',exact:true}).waitFor();
await page.getByText('Notification settings unavailable.',{exact:false}).waitFor();
assert.equal(await page.locator('.notification-panel .push-settings').count(),0);
// A pending notification status operation blocks workspace navigation.
await page.evaluate(()=>{const original=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).includes('/api/push/devices'))await new Promise(resolve=>window.finishSettingsRead=resolve);return original(...args);};});
await page.getByRole('button',{name:'Refresh status',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('.workspace-rail-link').getAttribute('aria-disabled')==='true');
await page.locator('.ops-sidebar').getByRole('link',{name:'Dashboard',exact:true}).dispatchEvent('click');
assert.equal(new URL(page.url()).searchParams.get('workspace'),'Settings');
await page.evaluate(()=>window.finishSettingsRead());
await page.waitForFunction(()=>!document.querySelector('.workspace-rail-link').hasAttribute('aria-disabled'));
for(const [width,height]of [[1440,900],[1280,720],[1024,480],[768,480],[390,844],[320,740]]){
 await page.setViewportSize({width,height});
 const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,rail:document.querySelector('.ops-sidebar').getBoundingClientRect().width}));
 assert.equal(geometry.overflow,false,`No horizontal overflow at ${width}`);assert.equal(geometry.rail,width>760?80:0);
 if(width>760) { assert.equal(await page.evaluate(()=>document.querySelector('.page-rail').getBoundingClientRect().bottom <= document.querySelector('.sidebar-footer').getBoundingClientRect().top),true,'Sidebar links must not overlap Settings in short windows'); await page.locator('.ops-sidebar').getByRole('link',{name:'Settings',exact:true}).scrollIntoViewIfNeeded(); assert.equal(await page.locator('.ops-sidebar').getByRole('link',{name:'Settings',exact:true}).isVisible(),true); }
 else assert.equal(await page.getByRole('combobox',{name:'Choose workspace'}).isVisible(),true);
 if(process.env.DESKTOP_TEST_SCREENSHOTS && [1440,390].includes(width))await page.screenshot({path:`${process.env.DESKTOP_TEST_SCREENSHOTS}/settings-${width}.png`,fullPage:true});
}
await page.getByRole('combobox',{name:'Choose workspace'}).selectOption('Schedule');
await page.waitForFunction(()=>new URL(location.href).searchParams.get('scheduleView')==='board');
await page.goto(`${fixture}?workspace=Settings&testRole=Dispatcher`);
await page.getByText('Manager access is required to manage phone notifications.').waitFor();
assert.equal(await page.locator('#opening-workspace option[value="Finance"]').count(),0);
assert.equal(await page.locator('.ops-sidebar').getByRole('link',{name:'Finance',exact:true}).count(),0);
assert.equal(await page.locator('.ops-sidebar').getByRole('link',{name:'The Huddle',exact:true}).count(),0);
await page.evaluate(()=>localStorage.setItem('opscenter-workspace-preferences-v1',JSON.stringify({openingWorkspace:'Finance'})));
// Also verify storage denial is reported, not represented as a successful save.
await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('Storage denied');};});
await page.getByLabel('Default opening page').selectOption('Marketing');
await page.getByText('Could not save this preference.',{exact:false}).waitFor();
await page.setViewportSize({width:1280,height:720});
await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
assert.equal(await page.getByRole('button',{name:'Expand sidebar',exact:true}).isVisible(),true);
assert.deepEqual(errors,[]);
await browser.close();console.log('Direct navigation, dated subpages, preferences, role gates, mutation guard and responsive Settings passed.');
