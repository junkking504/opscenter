import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {createContinuityProxy, standbyRequest} from '../deploy/vps/continuity-proxy.mjs';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
function close(server) {server.closeAllConnections(); return new Promise(resolve => server.close(resolve));}

test('recovery denies writes, hooks, actions, GET verification and unknown routes', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(standbyRequest(method, '/api/desktop/schedule/operations'), null);
  for (const url of ['/api/desktop/schedule/creation/check', '/api/integrations/linxup/push', '/api/desktop/control', '/api/new-read-or-write-route', '/crew/pay', '/api/%2564esktop/finance']) assert.equal(standbyRequest('GET', url), null);
  assert.equal(standbyRequest('GET','/api/desktop/schedule?date=2026-09-14&load=1&refresh=1'),'/api/desktop/schedule?date=2026-09-14');
  assert.equal(standbyRequest('GET','/api/desktop/krewe?employee=Example&verify=1&receipt=x'), '/api/desktop/krewe?employee=Example');
  assert.equal(standbyRequest('POST','/api/auth/login'),'/api/auth/login');
});

test('primary -> isolated recovery -> primary; writes never reach recovery', async () => {
  let available = true; const seenPrimary = [], seenStandby = [];
  const primary = http.createServer((req,res) => {seenPrimary.push([req.method, req.url]); if (!available) {req.socket.destroy(); return;} res.end('primary');});
  const standby = http.createServer((req,res) => {seenStandby.push([req.method, req.url, req.headers.cookie]); if(req.url==='/') {res.setHeader('content-type','text/html');res.end('<html><body><main>Schedule</main></body></html>');} else res.end('standby');});
  const primaryUrl = await listen(primary), standbyUrl = await listen(standby);
  const gateway = createContinuityProxy({primary:primaryUrl,standby:standbyUrl,probeCacheMs:0,timeout:100});
  const base = await listen(gateway);
  try {
    assert.equal(await (await fetch(base)).text(),'primary');
    available = false;
    let response = await fetch(base); const html=await response.text();
    assert.equal(response.headers.get('x-opscenter-continuity'),'read-only-recovery');
    assert.match(html,/Recovery view/); assert.match(html,/<main>Schedule/);
    response=await fetch(base+'/api/desktop/schedule?load=1&refresh=1&date=2026-09-14',{headers:{cookie:'synthetic=fixture'}});
    assert.equal(await response.text(),'standby');
    assert.ok(seenStandby.some(row=>row[1]==='/api/desktop/schedule?date=2026-09-14'&&row[2]==='synthetic=fixture'));
    response=await fetch(base+'/api/desktop/finance',{method:'POST',body:'synthetic mutation'});
    assert.equal(response.status,503); assert.equal((await response.json()).code,'standby_read_only');
    assert.equal(seenStandby.filter(row=>row[0]==='POST').length,0);
    available=true;
    assert.equal(await (await fetch(base)).text(),'primary');
  } finally {await close(gateway);await close(primary);await close(standby);}
});

test('lost primary response is never replayed to either origin',async()=>{
  let submitted=0, standbySubmissions=0;
  const primary=http.createServer((req,res)=>{if(req.method==='POST'){submitted++;req.resume();req.socket.destroy();}else res.end('ready');});
  const standby=http.createServer((req,res)=>{if(req.method==='POST')standbySubmissions++;res.end('ready');});
  const gateway=createContinuityProxy({primary:await listen(primary),standby:await listen(standby),probeCacheMs:0,timeout:100});
  const base=await listen(gateway);
  try {const response=await fetch(base+'/api/desktop/finance',{method:'POST',body:'synthetic'});assert.equal(response.status,502);assert.equal((await response.json()).code,'origin_response_unknown');assert.equal(submitted,1);assert.equal(standbySubmissions,0);}
  finally {await close(gateway);await close(primary);await close(standby);}
});

test('authentication egress permits only the exact existing issuer on TLS',async()=>{
  const {allowedAuthority,createAuthEgress}=await import('../deploy/vps/continuity-auth-egress.mjs');
  assert.equal(allowedAuthority('example.cloudflareaccess.com:443','example.cloudflareaccess.com'),true);
  for(const authority of ['api.openai.com:443','junkware.com:443','example.cloudflareaccess.com.evil:443','example.cloudflareaccess.com:80','user@example.cloudflareaccess.com:443','127.0.0.1:443']) assert.equal(allowedAuthority(authority,'example.cloudflareaccess.com'),false);
  assert.throws(()=>createAuthEgress('example.com'));
  const server=createAuthEgress('example.cloudflareaccess.com');const base=await listen(server);
  try{assert.equal((await fetch(base)).status,403);}finally{await close(server);}
});
