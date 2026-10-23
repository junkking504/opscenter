import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {NextRequest} from 'next/server';
import {AUTH_SESSION_COOKIE,AUTH_TRUSTED_DEVICE_COOKIE,inspectAuthSessionCookie,verifyTrustedDeviceCookie,verifyOpsCredentials,opsAuthDisplayName} from '../lib/auth';
import {POST as login} from '../app/api/auth/login/route';
import {waypointAccount} from '../lib/waypoint-account';
import {middleware} from '../middleware';
import {authorizeOpsRequest} from '../lib/ops-roles';
const password='fictional-test-password';
const salt=Buffer.from('named-account-test-only');
const hash=`pbkdf2-sha256$100000$${salt.toString('base64url')}$${pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64url')}`;
const rows=['alpha','beta','gamma'].map(username=>({username,displayName:`Test ${username}`,role:'manager',passwordHash:hash,active:true}));
async function main(){
 process.env.OPS_AUTH_USERNAME='shared';process.env.OPS_AUTH_PASSWORD_HASH=hash;process.env.OPS_AUTH_SESSION_SECRET='fixture-named-accounts-only';
 for(const name of ['OPS_ACCESS_AUD','OPS_ACCESS_TEAM_DOMAIN','OPS_CREW_ACCESS_TEAM_DOMAIN'])delete process.env[name];
 process.env.OPS_AUTH_ACCOUNTS_JSON=JSON.stringify(rows);
 assert.equal(await verifyOpsCredentials('shared',password),true);
 const {createAuthSessionCookieValue}=await import('../lib/auth');
 assert.equal(await waypointAccount(new Request('https://waypoint.junk-king.app/api/crew-jobs/manager',{headers:{cookie:`${AUTH_SESSION_COOKIE}=${await createAuthSessionCookieValue('shared@junk-king.com')}`}})),null,'Shared credentials do not gain Waypoint account access');
 for(const row of rows){
  const request=new Request('https://waypoint.junk-king.app/api/auth/login',{method:'POST',headers:{'content-type':'application/json','user-agent':'named-test'},body:JSON.stringify({username:row.username.toUpperCase(),password,next:'/crew-jobs'})});
  const response=await login(request);assert.equal(response.status,303);assert.equal(response.headers.get('location'),'https://waypoint.junk-king.app/crew-jobs');
  const cookie=response.cookies.get(AUTH_SESSION_COOKIE)!.value;
  const identity=`${row.username}@junk-king.com`;
  assert.equal((await inspectAuthSessionCookie(cookie)).session?.email,identity);assert.equal((await inspectAuthSessionCookie(cookie)).session?.role,'manager');
  assert.equal(opsAuthDisplayName(identity),row.displayName);
  assert.equal(authorizeOpsRequest('manager','/api/desktop/maintenance/recovery','POST').allowed,false);
  const accountRequest=new Request('https://waypoint.junk-king.app/api/crew-jobs/manager',{headers:{cookie:`${AUTH_SESSION_COOKIE}=${cookie}`}});
  assert.equal((await waypointAccount(accountRequest))?.email,identity);
  const trust=response.cookies.get(AUTH_TRUSTED_DEVICE_COOKIE)!.value;
  assert.equal((await verifyTrustedDeviceCookie(trust,request))?.email,identity);
  for(const path of ['/login','/api/auth/login','/api/auth/logout','/api/crew-jobs/manager-session'])assert.equal((await middleware(new NextRequest(`https://waypoint.junk-king.app${path}`))).headers.get('x-middleware-next'),'1');
  assert.equal((await middleware(new NextRequest('https://waypoint.junk-king.app/api/manual-bonuses'))).status,404);
  for(const host of ['kingpin.junk-king.app','jobs.junk-king.app'])for(const path of ['/login','/api/auth/login','/api/auth/logout','/api/crew-jobs/manager-session'])assert.equal((await middleware(new NextRequest(`https://${host}${path}`))).status,404,`${host} must not serve ${path}`);
  row.active=false;process.env.OPS_AUTH_ACCOUNTS_JSON=JSON.stringify(rows);
  assert.equal(await verifyOpsCredentials(row.username,password),false);assert.equal((await inspectAuthSessionCookie(cookie)).session,null);assert.equal(await verifyTrustedDeviceCookie(trust,request),null);assert.equal(await waypointAccount(accountRequest),null);
  row.active=true;process.env.OPS_AUTH_ACCOUNTS_JSON=JSON.stringify(rows);
  process.env.OPS_ACCESS_AUD='fixture';process.env.OPS_ACCESS_TEAM_DOMAIN='https://access.example.test';
  process.env.OPS_AUTH_ACCOUNTS_JSON='[]';assert.equal((await inspectAuthSessionCookie(cookie)).session,null);assert.equal(await verifyTrustedDeviceCookie(trust,request),null);
  delete process.env.OPS_ACCESS_AUD;delete process.env.OPS_ACCESS_TEAM_DOMAIN;process.env.OPS_AUTH_ACCOUNTS_JSON=JSON.stringify(rows);
 }
 assert.equal(await verifyOpsCredentials('alpha','incorrect'),false);assert.equal(await verifyOpsCredentials('unknown',password),false);
 rows[0].role='operator';process.env.OPS_AUTH_ACCOUNTS_JSON=JSON.stringify(rows);
 const response=await login(new Request('https://ops.example.test/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'alpha',password})}));
 assert.equal(await waypointAccount(new Request('https://waypoint.junk-king.app/api/crew-jobs/manager',{headers:{cookie:`${AUTH_SESSION_COOKIE}=${response.cookies.get(AUTH_SESSION_COOKIE)!.value}`}})),null);
 for(const invalid of ['{',JSON.stringify([...rows,rows[0]]),JSON.stringify([{...rows[0],role:'superuser'}])]){process.env.OPS_AUTH_ACCOUNTS_JSON=invalid;assert.equal(await verifyOpsCredentials('alpha',password),false);assert.equal(await verifyOpsCredentials('shared',password),true);}
 console.log('PASS: named login identities, manager roles, shared login, invalid credentials/config, account retirement/session revocation, Waypoint account scope and host boundaries.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
