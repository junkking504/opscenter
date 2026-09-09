import assert from 'node:assert/strict';
import { generateKeyPairSync, pbkdf2Sync, sign } from 'node:crypto';
import { NextRequest } from 'next/server';
import { AUTH_SESSION_COOKIE, AUTH_TRUSTED_DEVICE_COOKIE, createAuthSessionCookieValue, createTrustedDeviceCookieValue, inspectAuthSessionCookie, opsAuthIdentity, verifyTrustedDeviceCookie } from '../lib/auth';
import { POST as login } from '../app/api/auth/login/route';
import { middleware } from '../middleware';
import { opsRoleCan } from '../lib/ops-roles';

async function main() {
  process.env.OPS_AUTH_USERNAME = 'shared-test';
  process.env.OPS_AUTH_SESSION_SECRET = 'shared-login-regression-only';
  for (const key of ['OPS_AUTH_ROLE','OPS_AUTH_DEFAULT_ROLE','OPS_AUTH_ROLE_BINDINGS','OPS_ACCESS_AUD','OPS_ACCESS_TEAM_DOMAIN','OPS_CREW_ACCESS_TEAM_DOMAIN']) delete process.env[key];
  const salt = Buffer.from('shared-login-test-salt');
  const password = 'test-password-only';
  process.env.OPS_AUTH_PASSWORD_HASH = `pbkdf2-sha256$100000$${salt.toString('base64url')}$${pbkdf2Sync(password,salt,100000,32,'sha256').toString('base64url')}`;
  const oldIdentity = 'retired-email@junk-king.com';
  const oldCookie = await createAuthSessionCookieValue(oldIdentity);
  const request = new NextRequest('https://ops.example.test/desktop?workspace=Krewe&kreweView=payperiod', { headers: { 'user-agent': 'old-browser', 'cf-connecting-ip': '192.0.2.10' } });
  const oldTrust = await createTrustedDeviceCookieValue(oldIdentity, request);
  assert.equal((await inspectAuthSessionCookie(oldCookie)).reason, 'session_identity_retired');
  assert.equal(await verifyTrustedDeviceCookie(oldTrust, request), null);
  const oldHeaders = new Headers(request.headers);
  oldHeaders.set('cookie', `${AUTH_SESSION_COOKIE}=${oldCookie}; ${AUTH_TRUSTED_DEVICE_COOKIE}=${oldTrust}`);
  for (const path of ['/desktop?workspace=Krewe&kreweView=payperiod', '/login']) {
    const response = await middleware(new NextRequest(`https://ops.example.test${path}`, { headers: oldHeaders }));
    if (path === '/login') assert.equal(response.headers.get('x-middleware-next'), '1', 'Retired trusted cookies must not skip the credential form.');
    else { assert.equal(response.status,307); assert.equal(new URL(response.headers.get('location')!).pathname,'/login'); }
  }
  let sharedCookie = '';
  for (const [browser, address] of [['Desktop browser','192.0.2.11'], ['Phone browser','198.51.100.12']]) {
    const response = await login(new Request('https://ops.example.test/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json','user-agent':browser,'cf-connecting-ip':address, cookie:oldHeaders.get('cookie')!}, body:JSON.stringify({username:' SHARED-TEST ',password,next:'/desktop?workspace=Krewe&kreweView=payperiod'}) }));
    assert.equal(response.status,303);
    sharedCookie = response.cookies.get(AUTH_SESSION_COOKIE)!.value;
    const session = (await inspectAuthSessionCookie(sharedCookie)).session!;
    assert.equal(session.email,opsAuthIdentity());
    assert.equal(session.role,'admin');
    assert.equal(opsRoleCan(session.role,'finance.read'),true);
    const trustRequest = new Request('https://ops.example.test/desktop',{headers:{'user-agent':browser,'cf-connecting-ip':address}});
    assert.equal((await verifyTrustedDeviceCookie(response.cookies.get(AUTH_TRUSTED_DEVICE_COOKIE)!.value, trustRequest))?.role,'admin');
  }
  const badLogin = await login(new Request('https://ops.example.test/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'shared-test',password:'wrong'})}));
  assert.equal(badLogin.status,401);
  assert.equal(badLogin.cookies.get(AUTH_SESSION_COOKIE),undefined);

  // Exercise a verified Access assertion without calling any provider.
  process.env.OPS_ACCESS_TEAM_DOMAIN = 'https://access.example.test';
  process.env.OPS_ACCESS_AUD = 'test-audience';
  const {privateKey,publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
  const header = Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url');
  const payload = Buffer.from(JSON.stringify({email:oldIdentity,iss:process.env.OPS_ACCESS_TEAM_DOMAIN,aud:'test-audience',exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
  const token = `${header}.${payload}.${sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url')}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({keys:[{...publicKey.export({format:'jwk'}),kid:'test-key'}]});
  try {
    assert.equal((await inspectAuthSessionCookie(oldCookie)).session?.role,'operator', 'Configured individual Access mode retains its role boundary.');
    const response = await middleware(new NextRequest('https://ops.example.test/api/desktop/krewe?view=payperiod',{headers:{cookie:`${AUTH_SESSION_COOKIE}=${sharedCookie}`,'cf-access-jwt-assertion':token}}));
    assert.equal(response.headers.get('x-middleware-next'),'1');
    assert.equal(response.cookies.get(AUTH_SESSION_COOKIE),undefined,'Access must not replace the valid shared account.');
  } finally { globalThis.fetch = originalFetch; }
  console.log('Shared-login identity, two-device login, retired-session recovery, and Access precedence checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
