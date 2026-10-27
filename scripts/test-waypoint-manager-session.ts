import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {waypointEntryTarget} from '../lib/waypoint-entry';
import * as jsx from 'react/jsx-runtime';
import {NextRequest} from 'next/server';
import * as auth from '../lib/auth';
import {isWaypointAccount,waypointAccount} from '../lib/waypoint-account';
import {middleware} from '../middleware';
import {GET as managerSession} from '../app/api/crew-jobs/manager-session/route';

async function main(){
 process.env.OPS_AUTH_USERNAME='shared';process.env.OPS_AUTH_SESSION_SECRET='synthetic-manager-session-test';
 for(const name of ['OPS_ACCESS_AUD','OPS_ACCESS_TEAM_DOMAIN','OPS_CREW_ACCESS_TEAM_DOMAIN'])delete process.env[name];
 const row={username:'fixture-manager',displayName:'Fixture Manager',role:'manager',active:true,passwordHash:'unused'};
 process.env.OPS_AUTH_ACCOUNTS_JSON=JSON.stringify([row]);
 const identity='fixture-manager@junk-king.com',origin='https://waypoint.junk-king.app';
 const request=(path:string,cookie='',method='GET')=>new NextRequest(origin+path,{method,headers:{cookie,'user-agent':'synthetic-browser',...(method==='POST'?{origin,'content-type':'application/json'}:{})}});
 const trust=await auth.createTrustedDeviceCookieValue(identity,request('/crew-jobs'));
 const trusted=`${auth.AUTH_TRUSTED_DEVICE_COOKIE}=${trust}`;
 for(const host of ['waypoint.junk-king.app','kingpin.junk-king.app','jobs.junk-king.app'])for(const path of ['/crew-jobs','/login','/api/crew-jobs/manager-session','/api/crew-jobs/manager?resource=schedule']){
  const res=await middleware(new NextRequest(`https://${host}${path}`,{headers:{cookie:trusted,'user-agent':'synthetic-browser'}}));
  const renewed=res.cookies.get(auth.AUTH_SESSION_COOKIE)?.value;
  assert.ok(renewed,`${host}${path} restores remembered manager`);
  assert.equal((await auth.verifyAuthSessionCookie(renewed))?.email,identity);
  const forwarded=res.headers.get('x-middleware-request-cookie');assert.ok(forwarded,'restored identity reaches current request');
  assert.equal((await (await managerSession(request('/api/crew-jobs/manager-session',forwarded))).json()).manager,true);
  assert.match(res.headers.get('cache-control')||'',/no-store/);
 }
 const write=await middleware(request('/api/crew-jobs/manager?resource=operations',trusted,'POST'));
 assert.equal((await waypointAccount(request('/api/crew-jobs/manager',write.headers.get('x-middleware-request-cookie')!,'POST')))?.email,identity,'delegated handlers receive restored session');
 for(const path of ['/api/manual-bonuses','/api/desktop/maintenance/recovery','/api/desktop/schedule/operations'])assert.equal((await middleware(request(path,trusted))).status,404);
 assert.equal((await middleware(request('/api/auth/logout',trusted))).cookies.get(auth.AUTH_SESSION_COOKIE),undefined,'logout cannot restore a session');
 const current=await auth.createAuthSessionCookieValue(identity);
 assert.equal((await middleware(request('/crew-jobs',trusted+`; ${auth.AUTH_SESSION_COOKIE}=${current}`))).cookies.get(auth.AUTH_SESSION_COOKIE),undefined,'fresh session unchanged');
 const old=await auth.createAuthSessionCookieValue(identity,new Date(Date.now()-31*86400000));
 assert.ok((await middleware(request('/crew-jobs',trusted+`; ${auth.AUTH_SESSION_COOKIE}=${old}`))).cookies.get(auth.AUTH_SESSION_COOKIE));
 const shared=await auth.createAuthSessionCookieValue('shared@junk-king.com');
 assert.equal((await middleware(request('/crew-jobs',trusted+`; ${auth.AUTH_SESSION_COOKIE}=${shared}`))).cookies.get(auth.AUTH_SESSION_COOKIE),undefined,'never replace a different signed-in identity');
 const expiredTrust=await auth.createTrustedDeviceCookieValue(identity,request('/crew-jobs'),new Date(Date.now()-31*86400000));
 for(const cookies of ['',`${auth.AUTH_TRUSTED_DEVICE_COOKIE}=invalid`,`${auth.AUTH_TRUSTED_DEVICE_COOKIE}=${expiredTrust}`,trusted+'; '+trusted,trusted+`; ${auth.AUTH_SESSION_COOKIE}=one; ${auth.AUTH_SESSION_COOKIE}=two`])assert.equal((await middleware(request('/crew-jobs',cookies))).cookies.get(auth.AUTH_SESSION_COOKIE),undefined);
 for(const update of [{active:false},{active:true,role:'operator'}]){
  Object.assign(row,update);process.env.OPS_AUTH_ACCOUNTS_JSON=JSON.stringify([row]);
  assert.equal((await middleware(request('/crew-jobs',trusted))).cookies.get(auth.AUTH_SESSION_COOKIE),undefined,'retirement/demotion cannot restore manager');
  assert.equal(await waypointAccount(request('/api/crew-jobs/manager',`${auth.AUTH_SESSION_COOKIE}=${current}`)),null);
 }
 row.role='manager';process.env.OPS_AUTH_ACCOUNTS_JSON=JSON.stringify([row]);
 const code=ts.transpileModule(fs.readFileSync('app/login/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 let loginCookie=shared;
 const exports:{default?:(args:unknown)=>Promise<unknown>}={};
 // The VM tests login behavior; CSS is bundled separately by Next. Keep the import allowlist explicit.
 const mocks:Record<string,unknown>={'@/app/secondary-pages.css':{},'react/jsx-runtime':jsx,'next/headers':{headers:async()=>new Headers({host:'waypoint.junk-king.app'}),cookies:async()=>({get:()=>({value:loginCookie})})},'next/navigation':{redirect:(path:string)=>{throw new Error('REDIRECT '+path);}},'@/lib/auth':auth,'@/lib/waypoint-entry':{waypointEntryTarget},'@/lib/waypoint-account':{isWaypointAccount},'@/components/OpsCenterLogo':{default:()=>null}};
 vm.runInNewContext(code,{exports,require:(key:string)=>{assert.ok(key in mocks,key);return mocks[key];}});
 assert.ok(await exports.default!({}), 'shared account can see manager sign-in instead of a redirect loop');
 loginCookie=current;await assert.rejects(()=>exports.default!({}),/REDIRECT \/crew-jobs/);
 await assert.rejects(()=>exports.default!({searchParams:Promise.resolve({next:'/crew-jobs?view=updates'})}),/REDIRECT \/crew-jobs\?view=updates/);
 for(const next of ['https://outside.invalid','//outside.invalid','/api/private','/crew-jobs?view=other'])assert.equal(waypointEntryTarget(next),'/crew-jobs');
 for(let i=0;i<3;i++)assert.equal((await (await managerSession(request('/api/crew-jobs/manager-session',`${auth.AUTH_SESSION_COOKIE}=${current}`))).json()).manager,true,'Repeated reads preserve the current manager identity');
 row.role='operator';process.env.OPS_AUTH_ACCOUNTS_JSON=JSON.stringify([row]);assert.ok(await exports.default!({}),'operator can reach manager sign-in');
 console.log('PASS: remembered manager restoration on all Waypoint hosts and GET/POST, request forwarding, restricted routes, logout, expiry, duplicate cookies, role retirement/demotion, identity precedence and manager sign-in loops. Synthetic identities only.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
