import assert from 'node:assert/strict';
import {currentWorkspaceUrl} from '../lib/legacy-workspace-redirect';
for(const [route,workspace] of Object.entries({'/':'Command','/jobs':'Schedule','/fleet':'Fleet','/crew':'Krewe','/finance':'Finance','/marketing':'Marketing'})) {
 const result=currentWorkspaceUrl(new URL(`https://ops.example.invalid${route}?date=2026-10-08&truck=Truck%204`))!;
 assert.equal(result.pathname,'/desktop');assert.equal(result.searchParams.get('workspace'),workspace);assert.equal(result.searchParams.get('date'),'2026-10-08');assert.equal(result.searchParams.get('truck'),'Truck 4');
}
for(const route of ['/desktop','/api/desktop/schedule','/crew-jobs','/truck-inspection','/jobs/123'])assert.equal(currentWorkspaceUrl(new URL(`https://ops.example.invalid${route}`)),null);
assert.equal(currentWorkspaceUrl(new URL('https://ops.example.invalid/jobs?view=calendar'))!.searchParams.get('scheduleView'),'calendar');
assert.equal(currentWorkspaceUrl(new URL('https://ops.example.invalid/jobs?workspace=estimates'))!.searchParams.get('scheduleView'),'estimates');
console.log('Legacy workspace redirects preserve current layout and dated destinations.');

async function checkBoundary(){
 const {NextRequest}=await import('next/server');
 const {middleware}=await import('../middleware');
 const {createAuthSessionCookieValue,AUTH_SESSION_COOKIE,opsAuthIdentity}=await import('../lib/auth');
 process.env.OPS_AUTH_USERNAME='test-layout';process.env.OPS_AUTH_SESSION_SECRET='test-layout-secret';
 delete process.env.OPS_ACCESS_TEAM_DOMAIN;delete process.env.OPS_ACCESS_AUD;
 const cookie=await createAuthSessionCookieValue(opsAuthIdentity());
 for(const route of ['/jobs?date=2026-10-08','/fleet','/crew','/finance','/marketing']) {
  const response=await middleware(new NextRequest(`https://ops.example.invalid${route}`,{headers:{cookie:`${AUTH_SESSION_COOKIE}=${cookie}`}}));
  assert.equal(new URL(response.headers.get('location')!).pathname,'/desktop');
 }
 const unauth=await middleware(new NextRequest('https://ops.example.invalid/jobs'));
 assert.equal(new URL(unauth.headers.get('location')!).pathname,'/login');
 const phone=await middleware(new NextRequest('https://waypoint.junk-king.app/jobs',{headers:{host:'waypoint.junk-king.app'}}));assert.equal(phone.status,404);
 console.log('Route guard retains authentication and phone host boundaries.');
}
void checkBoundary();
