import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ReactNode} from 'react';
import {chromium,expect} from '@playwright/test';
import {waypointEntryTarget} from '../lib/waypoint-entry';

async function main(){
 const code=ts.transpileModule(fs.readFileSync('app/login/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 let host='waypoint.junk-king.app';
 const exports:{default?:(args:unknown)=>Promise<ReactNode>}={};
 const mocks:Record<string,unknown>={'./waypoint-login.css':{},'@/app/secondary-pages.css':{},'react/jsx-runtime':jsx,'next/headers':{headers:async()=>new Headers({host}),cookies:async()=>({get:()=>undefined})},'next/navigation':{redirect:()=>{throw new Error('Unexpected redirect');}},'@/lib/auth':{AUTH_SESSION_COOKIE:'fixture',verifyAuthSessionCookie:async()=>null,sanitizeAuthRedirectTarget:()=>'/desktop'},'@/lib/waypoint-entry':{waypointEntryTarget},'@/lib/waypoint-account':{isWaypointAccount:()=>false},'@/components/OpsCenterLogo':{default:()=>null}};
 vm.runInNewContext(code,{exports,require:(key:string)=>{assert.ok(key in mocks,key);return mocks[key];}});
 const readCss=(file:string):string=>fs.readFileSync(file,'utf8').replace(/@import "([^"]+)";/g,(_all,relative:string)=>readCss(path.resolve(path.dirname(file),relative)));
 const css=['app/ops-styles.css','styles/ops-theme.css','app/secondary-pages.css','app/login/waypoint-login.css'].map(readCss).join('\n');
 const render=async(error='')=>'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style>'+renderToStaticMarkup(await exports.default!({searchParams:Promise.resolve({error,next:'https://outside.invalid'})}));
 const normal=await render(),failed=await render('invalid-credentials'),limited=await render('rate-limited');
 host='ops.junk-king.app';assert.ok(!(await render()).includes('Back to Waypoint'),'Normal OpsCenter login unchanged');
 const browser=await chromium.launch({headless:true});let cases=0;
 try{
 for(const width of [320,390,1280]){
 const context=await browser.newContext({viewport:{width,height:844}});let posts=0;
 await context.addCookies([{name:'fixture_crew_session',value:'synthetic-preserved',domain:'waypoint.fixture',path:'/',secure:true,httpOnly:true}]);
 await context.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{value:true});if(!localStorage.getItem('fixture-draft'))localStorage.setItem('fixture-draft','synthetic-payment-and-photo-draft');});
 const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const r=route.request(),u=new URL(r.url());
  assert.equal(u.origin,'https://waypoint.fixture','No external destination');
  if(u.pathname==='/login')return route.fulfill({contentType:'text/html',body:u.search.includes('invalid-credentials')?failed:u.search.includes('rate-limited')?limited:normal});
  if(u.pathname==='/crew-jobs')return route.fulfill({contentType:'text/html',body:'<h1>Waypoint crew fixture</h1><a href="/login?next=%2Fcrew-jobs">Manager sign-in</a>'});
  if(u.pathname==='/api/auth/login'){posts++;return route.fulfill({contentType:'text/html',body:failed});}
  throw new Error('Unexpected request '+u.pathname);
 });
 // Direct launch has no useful prior page; fixed href still returns safely.
 await page.goto('https://waypoint.fixture/login?next=https://outside.invalid');
 const back=page.getByRole('link',{name:'Back to Waypoint'});await expect(back).toBeVisible();await expect(back).toHaveAttribute('href','/crew-jobs');
 assert.ok((await back.boundingBox())!.height>=44);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 if(process.env.WAYPOINT_LOGIN_SCREENSHOTS){fs.mkdirSync(process.env.WAYPOINT_LOGIN_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.WAYPOINT_LOGIN_SCREENSHOTS,`login-${width}.png`),fullPage:true});}
 await back.click();await expect(page.getByRole('heading',{name:'Waypoint crew fixture'})).toBeVisible();assert.equal(posts,0,'Back never submits credentials');
 // Enter, cancel, re-enter and leave after failed authentication.
 await page.getByRole('link',{name:'Manager sign-in'}).click();await back.click();
 await page.getByRole('link',{name:'Manager sign-in'}).click();await page.getByPlaceholder('Username',{exact:true}).fill('fixture');await page.getByPlaceholder('Password',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'Continue'}).click();
 await expect(page.getByRole('alert')).toContainText('Invalid');await back.click();assert.equal(posts,1);
 await page.goto('https://waypoint.fixture/login?error=rate-limited');await expect(page.getByRole('alert')).toContainText('Too many');await back.click();assert.equal(posts,1);
 assert.equal(await page.evaluate(()=>localStorage.getItem('fixture-draft')),'synthetic-payment-and-photo-draft');
 assert.equal((await context.cookies()).find(c=>c.name==='fixture_crew_session')?.value,'synthetic-preserved');assert.deepEqual(errors,[]);
 cases++;await context.close();
 }
 console.log(`PASS manager exit: ${cases} standalone-simulated widths, direct entry, enter/cancel/reenter, failed/rate-limited login, fixed destination, no submit on back, cookies/draft retained. Actual login page rendered with synthetic server dependencies; no auth grants.`);
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
