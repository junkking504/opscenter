import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {createOriginProxy,endToEnd} from '../deploy/macmini/origin-proxy.mjs';
import {atomicPrivate,readPrivate,validateSlot,validHealth,waitReady,inventoryAssets,staticPath,sleep} from '../deploy/macmini/origin-state.mjs';
import {probeSlot} from '../deploy/macmini/origin-state.mjs';
import {ReleaseTransaction,recoverDeadActivationLock} from '../deploy/macmini/release-transaction.mjs';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(()=>resolve());});
const health=slot=>({ok:true,runtime:'MISSION_CONTROL',release:{sha:slot.sha,instance:`process-${slot.id}`,pending:0,stopping:false},platformKernel:{runtime:'MISSION_CONTROL',enabled:true,healthy:true,status:'healthy',databaseName:'synthetic',migrationVersion:'0001_kernel.sql'},assignmentStoreWritable:true,operatorStateWritable:true});
async function fixture(probe){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ops-cutover-')));const stateDir=path.join(root,'state');fs.mkdirSync(stateDir,{mode:0o700});
  const slots={},servers=[],ports={},seen=[],handlers={};
  for(const [id,sha] of [['a','a'.repeat(40)],['b','b'.repeat(40)]]){
    const release=path.join(root,'releases',sha);fs.mkdirSync(path.join(release,'public/desktop-assets/.vite'),{recursive:true});fs.mkdirSync(path.join(release,'public/desktop-assets/assets'));fs.mkdirSync(path.join(release,'.next/static/chunks'),{recursive:true});
    fs.writeFileSync(path.join(release,'.opscenter-release'),`commit=${sha}\n`);
    fs.writeFileSync(path.join(release,'public/desktop-assets/.vite/manifest.json'),JSON.stringify({entry:{isEntry:true,file:`assets/index-${id.repeat(8)}.js`}}));
    fs.writeFileSync(path.join(release,'public/desktop-assets/assets',`index-${id.repeat(8)}.js`),`// synthetic ${id}`);
    const server=http.createServer((req,res)=>{
      const slot=slots[id];seen.push({id,method:req.method,url:req.url,headers:req.headers});
      if(req.url.startsWith('/api/health'))return res.end(JSON.stringify(health(slot)));
      if(req.url==='/login')return res.end('synthetic login');
      if(req.url===`/desktop-assets/assets/index-${id.repeat(8)}.js`)return res.end(`// synthetic ${id}`);
      if(handlers[id])return handlers[id](req,res);
      if(req.url.startsWith('/desktop-assets/')||req.url.startsWith('/_next/')){res.writeHead(404);return res.end('missing');}
      req.resume();res.end(id);
    });
    ports[id]=await listen(server);servers.push(server);slots[id]={version:1,id,port:ports[id],sha,release,database:'synthetic',migration:'0001_kernel.sql',instance:`process-${id}`,servedAt:id==='a'?new Date().toISOString():undefined,assets:inventoryAssets(release)};
    atomicPrivate(path.join(stateDir,`slot-${id}.json`),slots[id]);
  }
  atomicPrivate(path.join(stateDir,'active.json'),{version:1,generation:1,slot:'a',sha:slots.a.sha});
  const proxy=await createOriginProxy({stateDir,root,ports,probe});const port=await listen(proxy.server),base=`http://127.0.0.1:${port}`;
  async function activate(id,generation=2){atomicPrivate(path.join(stateDir,'active.json'),{version:1,generation,slot:id,sha:slots[id].sha});return proxy.activate(generation,slots[id].sha);}
  return {root,stateDir,slots,ports,seen,handlers,servers,proxy,port,base,activate,async cleanup(){await close(proxy.server);await Promise.all(servers.map(close));fs.rmSync(root,{recursive:true,force:true});}};
}

test('new requests on one keepalive connection switch generations without resets or replay',async()=>{
  const f=await fixture();const agent=new http.Agent({keepAlive:true,maxSockets:1});let sockets=new Set();
  const read=()=>new Promise((resolve,reject)=>{const req=http.get(f.base,{agent,headers:{host:'synthetic.invalid',cookie:'fixture=only',authorization:'Synthetic'}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve(body));res.on('error',reject);});req.on('socket',socket=>sockets.add(socket));req.on('error',reject);});
  try{
    assert.equal(await read(),'a');const inProgress=Promise.all(Array.from({length:80},()=>read()));await f.activate('b');const result=await inProgress;assert.equal(result.length,80);assert.ok(result.every(value=>value==='a'||value==='b'));assert.equal(await read(),'b');assert.equal(sockets.size,1);
    assert.ok(f.seen.filter(row=>row.url==='/').every(row=>row.headers.host==='synthetic.invalid'&&row.headers.cookie==='fixture=only'&&row.headers.authorization==='Synthetic'));
    assert.equal(f.proxy.status().slots.reduce((n,row)=>n+row.inFlight+row.uncertain,0),0);
  }finally{agent.destroy();await f.cleanup();}
});
test('slow submitted upload stays on old slot while new traffic moves; exactly one write',async()=>{
  const f=await fixture();const writes=[];
  f.handlers.a=(req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{writes.push(body);res.end('saved-a');});};
  try{
    const done=new Promise((resolve,reject)=>{const req=http.request(f.base+'/write',{method:'POST'},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve(body));});req.on('error',reject);req.write('first-');setTimeout(()=>req.end('second'),100);});
    await sleep(20);assert.equal(f.proxy.status().slots[0].inFlight,1);await f.activate('b');assert.equal(await(await fetch(f.base)).text(),'b');assert.equal(await done,'saved-a');assert.deepEqual(writes,['first-second']);
  }finally{await f.cleanup();}
});
test('browser disconnect after complete submission does not cancel or replay upstream write',async()=>{
  const f=await fixture();let writes=0,finished=false;
  f.handlers.a=(req,res)=>{req.resume();req.on('end',()=>{writes++;setTimeout(()=>{finished=true;res.end('saved');},90);});};
  try{
    const req=http.request(f.base+'/write',{method:'POST'});req.on('error',()=>{});req.end('synthetic');await sleep(30);req.destroy();await f.activate('b');await sleep(100);assert.equal(writes,1);assert.equal(finished,true);assert.equal(f.proxy.status().slots.find(row=>row.sha===f.slots.a.sha).inFlight,0);
  }finally{await f.cleanup();}
});
test('lost upstream response remains uncertain and is never retried',async()=>{
  const f=await fixture();let writes=0;f.handlers.a=(req,res)=>{req.resume();req.on('end',()=>{writes++;res.destroy();});};
  try{const response=await fetch(f.base+'/write',{method:'POST',body:'synthetic'});assert.equal(response.status,502);assert.equal((await response.json()).code,'origin_response_unknown');assert.equal(writes,1);assert.equal(f.proxy.status().slots[0].uncertain,1);assert.equal(f.seen.filter(row=>row.id==='b'&&row.method==='POST').length,0);}
  finally{await f.cleanup();}
});
test('truncated upload blocks retirement instead of treating socket close as completion',async()=>{
  const f=await fixture();f.handlers.a=req=>req.resume();
  try{const req=http.request(f.base+'/write',{method:'POST',headers:{'content-length':'1000'}});req.on('error',()=>{});req.write('partial');await sleep(30);req.destroy();await sleep(40);assert.equal(f.proxy.status().slots[0].uncertain,1);}
  finally{await f.cleanup();}
});
test('old hashed assets fall back only through a validated retained inventory',async()=>{
  const f=await fixture();
  try{await f.activate('b');const result=await fetch(f.base+'/desktop-assets/assets/index-aaaaaaaa.js');assert.equal(result.status,200);assert.equal(await result.text(),'// synthetic a');assert.equal(result.headers.get('x-opscenter-asset-release'),f.slots.a.sha);
    for(const raw of ['/api/desktop/finance','/login','/_next/static/../private-aaaaaaaa.js','/desktop-assets/assets/%2e%2e/private-aaaaaaaa.js','//desktop-assets/assets/private-aaaaaaaa.js','/desktop-assets/assets/unhashed.js'])assert.equal(staticPath(raw),null);
    assert.equal((await fetch(f.base+'/desktop-assets/assets/index-aaaaaaaa.js',{method:'POST',body:'x'})).status,404);
    fs.writeFileSync(path.join(f.slots.a.release,'public/desktop-assets/assets/hidden-cccccccc.js'),'not inventoried');assert.equal((await fetch(f.base+'/desktop-assets/assets/hidden-cccccccc.js')).status,404);
  }finally{await f.cleanup();}
});
test('invalid active manifest preserves acknowledged traffic; startup rejects it',async()=>{
  const f=await fixture();
  try{atomicPrivate(path.join(f.stateDir,'active.json'),{version:1,generation:2,slot:'b',sha:f.slots.a.sha});await assert.rejects(f.proxy.activate(2,f.slots.a.sha));assert.equal(await(await fetch(f.base)).text(),'a');await assert.rejects(createOriginProxy({stateDir:f.stateDir,root:f.root,ports:f.ports}));}
  finally{await f.cleanup();}
});
test('proxy restart restores pinned generation but does not erase uncertain drain accounting',async()=>{
  const f=await fixture();let restarted;
  try{await f.activate('b');await close(f.proxy.server);restarted=await createOriginProxy({stateDir:f.stateDir,root:f.root,ports:f.ports});const port=await listen(restarted.server);assert.equal(await(await fetch(`http://127.0.0.1:${port}`)).text(),'b');assert.ok(restarted.status().slots.every(row=>row.uncertain>0));}
  finally{if(restarted)await close(restarted.server);await f.cleanup();}
});
test('known read-only EventSource can reconnect; arbitrary streams are not forcibly retired',async()=>{
  const f=await fixture();f.handlers.a=(req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(': fixture\n\n');};
  const abort1=new AbortController(),abort2=new AbortController();
  try{const known=await fetch(f.base+'/api/desktop/events',{signal:abort1.signal});const other=await fetch(f.base+'/unknown-stream',{signal:abort2.signal});await f.activate('b');const result=f.proxy.retireStreams(f.slots.a.sha);assert.equal(result.ended,1);assert.equal(f.proxy.status().slots[0].inFlight,1);await known.text();await other.body.cancel();}
  finally{abort1.abort();abort2.abort();await f.cleanup();}
});
test('readiness requires exact identity, writable state, enabled kernel and migration',async()=>{
  const f=await fixture();try{const value=health(f.slots.a);assert.equal(validHealth(value,f.slots.a),true);for(const changed of [{...value,ok:false},{...value,release:{...value.release,sha:f.slots.b.sha}},{...value,assignmentStoreWritable:false},{...value,platformKernel:{...value.platformKernel,enabled:false}},{...value,platformKernel:{...value.platformKernel,migrationVersion:'9999_wrong.sql'}}])assert.equal(validHealth(changed,f.slots.a),false);
    let calls=0;const start=Date.now();await waitReady(f.slots.a,{deadlineMs:100,spacingMs:12,minimumMs:24,probe:async()=>{calls++;return value;}});assert.ok(calls>=3&&Date.now()-start>=24);
    const stalled=Date.now();await assert.rejects(waitReady(f.slots.a,{deadlineMs:35,spacingMs:5,probe:()=>new Promise(()=>{})}));assert.ok(Date.now()-stalled<150);
    const wrong={...f.slots.a,port:f.slots.b.port};assert.throws(()=>validateSlot(wrong,{root:f.root,ports:f.ports}));fs.chmodSync(path.join(f.stateDir,'slot-a.json'),0o644);assert.throws(()=>readPrivate(path.join(f.stateDir,'slot-a.json')));
  }finally{await f.cleanup();}
});
test('hop-by-hop stripping preserves ordinary authentication and forwarded headers',()=>{
  assert.deepEqual(endToEnd({connection:'keep-alive, x-hop','x-hop':'remove',cookie:'fixture',authorization:'fixture',host:'fixture.invalid','x-forwarded-proto':'https','transfer-encoding':'chunked'}),{cookie:'fixture',authorization:'fixture',host:'fixture.invalid','x-forwarded-proto':'https'});
});

function transaction(f,overrides={}){
  let linked=f.slots.a.sha;const running={a:true,b:true},stops=[],services=[];
  const hooks={
    control:async(endpoint,input)=>endpoint==='/status'?f.proxy.status():endpoint==='/activate'?f.proxy.activate(input.generation,input.sha):f.proxy.retireStreams(input.sha),
    probe:probeSlot,ready:slot=>waitReady(slot,{deadlineMs:250,spacingMs:5,minimumMs:10}),running:async slot=>running[slot.id],
    linkSha:()=>linked,link:slot=>{linked=slot.sha;},expected:async()=>({database:'synthetic',migration:'0001_kernel.sql'}),
    start:async slot=>{running[slot.id]=true;f.slots[slot.id]=slot;},stop:async slot=>{running[slot.id]=false;stops.push(slot.sha);},
    services:async slot=>{services.push(slot.sha);},publicProbe:async()=>{},lineage:async()=>{},...overrides,
  };
  return {run:new ReleaseTransaction({root:f.root,stateDir:f.stateDir,ports:f.ports,hooks,ownerPid:process.pid,observationMs:20,intervalMs:5}),hooks,stops,services,get linked(){return linked;}};
}
test('full transaction warms, acknowledges, links, restarts, observes and retires in order',async()=>{
  const f=await fixture();const phases=[];const t=transaction(f,{phase:value=>phases.push(value)});
  try{const result=await t.run.deploy(f.slots.b.sha);assert.equal(result.retirement,'complete');assert.equal(t.linked,f.slots.b.sha);assert.equal(f.proxy.status().active.sha,f.slots.b.sha);assert.ok(phases.indexOf('warmed')<phases.indexOf('switch-manifest'));assert.ok(phases.indexOf('switch-acknowledged')<phases.indexOf('linked'));assert.ok(phases.indexOf('services')<phases.indexOf('accepted'));assert.equal(t.services.length,1);assert.equal(t.run.journal().phase,'retired');}
  finally{await f.cleanup();}
});
test('singleton failure rolls traffic and link back without replay or Git rewind',async()=>{
  const f=await fixture();let calls=0;const previous=f.slots.a.sha;const t=transaction(f,{services:async()=>{if(++calls===1)throw new Error('Synthetic singleton failure');}});
  try{await assert.rejects(t.run.deploy(f.slots.b.sha));assert.equal(f.proxy.status().active.sha,previous);assert.equal(t.linked,previous);assert.equal(t.run.journal().phase,'rolled-back');assert.equal(calls,2);assert.equal(await(await fetch(f.base)).text(),'a');}
  finally{await f.cleanup();}
});
test('crash at every activation phase reconciles the journal without stopping active traffic',async()=>{
  for(const crash of ['pin-intent','prepared','warmed','traffic-intent','switch-intent','switch-manifest','switch-acknowledged','switched','linked','services','observing','accepted']){
    const f=await fixture();let crashed=false;const previous=f.slots.a.sha,candidate=f.slots.b.sha;
    const t=transaction(f,{phase:phase=>{if(!crashed&&phase===crash){crashed=true;throw Object.assign(new Error('Synthetic hard crash'),{simulatedCrash:true});}}});
    try{await assert.rejects(t.run.deploy(candidate));t.hooks.phase=()=>{};await t.run.recover();const expected=crash==='accepted'?candidate:previous;assert.equal(t.linked,expected,crash);assert.equal(f.proxy.status().active.sha,expected,crash);}
    finally{await f.cleanup();}
  }
});
test('unfinished post-response work defers retirement and the next deployment',async()=>{
  const f=await fixture();const previous=f.slots.a.sha;
  const t=transaction(f,{probe:async(slot,options)=>{const value=await probeSlot(slot,options);if(slot.sha===previous)value.release.pending=1;return value;}});
  try{const result=await t.run.deploy(f.slots.b.sha);assert.equal(result.retirement,'deferred');assert.equal(t.stops.filter(sha=>sha===previous).length,0);await assert.rejects(t.run.deploy('c'.repeat(40)),/unresolved work/);assert.equal(f.proxy.status().active.sha,f.slots.b.sha);}
  finally{await f.cleanup();}
});
test('moving production head during warmup leaves old traffic and link intact',async()=>{
  const f=await fixture();const previous=f.slots.a.sha;const t=transaction(f,{lineage:async()=>{throw new Error('Synthetic production moved');}});
  try{await assert.rejects(t.run.deploy(f.slots.b.sha));assert.equal(t.linked,previous);assert.equal(f.proxy.status().active.sha,previous);assert.equal(t.services.length,0);}
  finally{await f.cleanup();}
});

test('graceful proxy shutdown releases listener but finishes submitted upload exactly once',async()=>{
  const f=await fixture();let count=0;
  f.handlers.a=(req,res)=>{req.resume();req.on('end',()=>{count++;setTimeout(()=>res.end('saved'),60);});};
  try{
    const response=new Promise((resolve,reject)=>{const req=http.request(f.base+'/write',{method:'POST'},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve(body));});req.on('error',reject);req.write('part');setTimeout(()=>req.end('tail'),80);});
    await sleep(20);const closed=f.proxy.shutdown();
    await assert.rejects(fetch(f.base));assert.equal(await response,'saved');await closed;assert.equal(count,1);
    const ledger=JSON.parse(fs.readFileSync(path.join(f.stateDir,'proxy-runtime.json')));assert.equal(ledger.clean,true);
  }finally{await f.cleanup();}
});

test('bootstrap is gated by Central time and restores the original single process after each failed phase',async()=>{
  const {Bootstrap,outsideDispatch}=await import('../deploy/macmini/release-bootstrap.mjs');
  assert.equal(outsideDispatch(new Date('2026-10-09T22:59:00Z')),false);
  assert.equal(outsideDispatch(new Date('2026-10-09T23:00:00Z')),true);
  assert.equal(outsideDispatch(new Date('2026-10-09T11:59:00Z')),true);
  assert.equal(outsideDispatch(new Date('2026-10-09T12:00:00Z')),false);
  for(const failure of ['none','stopLegacy','portFree','startProxy','publicProbe']){
    const f=await fixture();let legacy=true,proxy=false,retired=false;
    const hooks={linkSha:()=>f.slots.a.sha,lineage:async()=>{},legacyIdentity:async()=>({pid:123,label:'com.openclaw.opscenter'}),installPlists:async()=>{},
      expected:async()=>({database:'synthetic',migration:'0001_kernel.sql'}),start:async()=>{},ready:async slot=>health(slot),
      outsideDispatch:()=>true,assertLegacy:async()=>{},stopLegacy:async()=>{legacy=false;},portFree:async()=>{},
      startProxy:async()=>{proxy=true;},proxyStatus:async()=>({active:{sha:f.slots.a.sha,generation:1},ledgerHealthy:true}),
      publicProbe:async()=>{},unloadDeadLegacy:async()=>{},stopProxy:async()=>{proxy=false;},portFreeOrLegacy:async()=>{},
      restoreLegacy:async()=>{legacy=true;},verifyLegacy:async()=>{assert.equal(legacy,true);},retirePreparedSlot:async()=>{assert.equal(legacy,true);retired=true;}};
    if(failure!=='none'){const actual=hooks[failure];hooks[failure]=async(...args)=>{await actual(...args);throw new Error('Synthetic bootstrap failure');};}
    const bootstrap=new Bootstrap({root:f.root,stateDir:f.stateDir,hooks,ownerPid:process.pid,ports:f.ports});
    try{
      await bootstrap.prepare();assert.equal(legacy,true);assert.equal(proxy,false);
      hooks.outsideDispatch=()=>false;await assert.rejects(bootstrap.activate(),/restricted/);assert.equal(legacy,true);
      hooks.outsideDispatch=()=>true;
      if(failure==='none'){await bootstrap.activate();assert.equal(legacy,false);assert.equal(proxy,true);assert.equal(bootstrap.read().phase,'complete');await bootstrap.rollback();}
      else await assert.rejects(bootstrap.activate(),/Synthetic bootstrap/);
      assert.equal(legacy,true);assert.equal(proxy,false);assert.equal(retired,true);assert.equal(bootstrap.read().phase,'rolled-back');
      assert.equal(JSON.parse(fs.readFileSync(path.join(f.stateDir,'enabled.json'))).enabled,false);
    }finally{await f.cleanup();}
  }
});

test('concurrent activation is rejected and superseded validation cannot change traffic',async()=>{
  let release,blocking=false;
  const f=await fixture(async slot=>{if(blocking)await new Promise(resolve=>{release=resolve;});return probeSlot(slot);});
  try{
    blocking=true;const pending=f.activate('b');await sleep(10);
    await assert.rejects(f.proxy.activate(2,f.slots.b.sha),/already in progress/);
    atomicPrivate(path.join(f.stateDir,'active.json'),{version:1,generation:3,slot:'a',sha:f.slots.a.sha});
    release();await assert.rejects(pending,/superseded/);assert.equal(await(await fetch(f.base)).text(),'a');
  }finally{await f.cleanup();}
});

test('upgraded transport remains on its original slot and blocks unproven retirement',async()=>{
  const f=await fixture();let peer,client;
  f.servers[0].on('upgrade',(req,socket,head)=>{peer=socket;assert.equal(req.headers.upgrade,'fixture');assert.equal(req.headers.cookie,'fixture=only');socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n');if(head.length)socket.write(head);socket.on('data',chunk=>socket.write(chunk));});
  try{
    client=net.createConnection({host:'127.0.0.1',port:f.port});let buffer='';client.on('data',chunk=>buffer+=chunk);client.on('error',()=>{});
    client.write('GET /fixture-upgrade HTTP/1.1\r\nHost: fixture.invalid\r\nConnection: Upgrade\r\nUpgrade: fixture\r\nCookie: fixture=only\r\n\r\n');
    for(let n=0;n<100&&!buffer.includes('\r\n\r\n');n++)await sleep(5);
    assert.match(buffer,/101 Switching/);await f.activate('b');client.write('still-a');
    for(let n=0;n<100&&!buffer.includes('still-a');n++)await sleep(5);
    assert.match(buffer,/still-a/);assert.equal(await(await fetch(f.base)).text(),'b');
    client.destroy();peer.destroy();await sleep(20);assert.equal(f.proxy.status().slots.find(row=>row.sha===f.slots.a.sha).uncertain,1);
  }finally{client?.destroy();peer?.destroy();await f.cleanup();}
});

test('dead activation lock recovery preserves evidence and refuses live owners or children',async()=>{
  const f=await fixture(),lock=path.join(f.root,'.deploy-lock'),state=path.join(f.root,'.release-slots');fs.mkdirSync(lock);fs.mkdirSync(state,{mode:0o700});
  const owner=path.join(lock,'owner'),journal=path.join(state,'transaction.json');
  try{
    fs.writeFileSync(owner,`pid=${process.pid}\n`);assert.throws(()=>recoverDeadActivationLock(f.root),/still live/);
    const dead=Number(execFileSync(process.execPath,['-e','console.log(process.pid)']).toString().trim());
    fs.writeFileSync(owner,`pid=${dead}\n`);atomicPrivate(journal,{version:1,ownerPid:dead,workerPid:process.pid});
    assert.throws(()=>recoverDeadActivationLock(f.root),/child still live/);assert.equal(fs.existsSync(lock),true);
    atomicPrivate(journal,{version:1,ownerPid:dead,workerPid:dead});recoverDeadActivationLock(f.root);
    assert.equal(fs.existsSync(lock),false);const saved=fs.readdirSync(f.root).find(name=>name.startsWith('.deploy-lock.recovered-'));
    assert.equal(fs.readFileSync(path.join(f.root,saved,'owner'),'utf8'),`pid=${dead}\n`);
  }finally{await f.cleanup();}
});

test('corrupt bootstrap PID cannot signal or replace a process',async()=>{
  const {Bootstrap}=await import('../deploy/macmini/release-bootstrap.mjs');const f=await fixture();let effects=0;
  const run=new Bootstrap({root:f.root,stateDir:f.stateDir,ports:f.ports,ownerPid:process.pid,hooks:{linkSha:()=>f.slots.a.sha,stopProxy:async()=>{effects++;}}});
  try{for(const pid of [-1,0,1,1.5,'123']){
    atomicPrivate(path.join(f.stateDir,'bootstrap.json'),{version:1,sha:f.slots.a.sha,phase:'prepared',legacy:{pid,label:'com.openclaw.opscenter'}});
    await assert.rejects(run.rollback(),/journal identity invalid/);
  }assert.equal(effects,0);}finally{await f.cleanup();}
});
