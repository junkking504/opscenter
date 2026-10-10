import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DEPLOY_ROOT, SLOT_PORTS, privateDirectory, readPrivate, atomicPrivate, validateGeneration, validateSlot, readSlot, probeSlot, staticFile} from './origin-state.mjs';

export function endToEnd(headers, upgrade = false) {
  const result = {...headers};
  const nominated = String(headers.connection || '').split(',').map(value => value.trim().toLowerCase());
  for (const key of [...nominated, 'connection','proxy-connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']) delete result[key];
  if (upgrade) { result.connection = 'Upgrade'; result.upgrade = headers.upgrade; }
  return result;
}
function json(res, status, body) {
  res.writeHead(status, {'content-type':'application/json', 'cache-control':'no-store'});
  res.end(JSON.stringify(body));
}
const mime = file => ({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.woff':'font/woff','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon'}[path.extname(file)]);

export async function createOriginProxy({stateDir = path.join(DEPLOY_ROOT,'.release-slots'), root = DEPLOY_ROOT, ports = SLOT_PORTS, probe = probeSlot} = {}) {
  privateDirectory(stateDir);
  const options = {root, ports};
  const activeFile = path.join(stateDir,'active.json');
  let active = validateGeneration(readPrivate(activeFile), stateDir, options);
  await probe(active.target); // Startup has no trusted in-memory target.
  atomicPrivate(path.join(stateDir,'ack.json'), {version:1,generation:active.generation,slot:active.slot,sha:active.sha,acknowledgedAt:new Date().toISOString()});
  const counts = new Map(), requests = new Set();
  const runtimeFile=path.join(stateDir,'proxy-runtime.json');
  let ledgerHealthy=true;
  const uncertainShas=new Set();
  if(fs.existsSync(runtimeFile)){
    const previous=readPrivate(runtimeFile);
    if(previous.version!==1||!Array.isArray(previous.referencedShas)||!Array.isArray(previous.uncertainShas))throw new Error('Proxy drain ledger invalid');
    for(const sha of [...(previous.clean===true?[]:previous.referencedShas),...previous.uncertainShas]){
      if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('Proxy drain ledger identity invalid');
      uncertainShas.add(sha);
    }
  }
  function persistRuntime(clean=false){
    const referencedShas=[active.sha];
    for(const id of ['a','b']){try{referencedShas.push(readSlot(stateDir,id,options).sha);}catch{/* Candidate may not exist. */}}
    atomicPrivate(runtimeFile,{version:1,pid:process.pid,clean,referencedShas:[...new Set(referencedShas)],uncertainShas:[...uncertainShas]});
  }
  persistRuntime();
  // Lost proxy accounting is never proof that an old application stopped work.
  // Restart restores routing but conservatively blocks retirement for old SHAs.
  for(const sha of uncertainShas)counts.set(sha,{sha,slot:null,inFlight:0,uncertain:1});
  let activation;
  function counter(target) {
    if (!counts.has(target.sha)) counts.set(target.sha,{sha:target.sha,slot:target.id,inFlight:0,uncertain:0});
    return counts.get(target.sha);
  }
  function track(target) {
    const stat = counter(target); stat.inFlight++;
    const record = {target,started:Date.now(),finished:false,uncertain:false,safeSse:false,retiring:false};
    requests.add(record);
    record.markUncertain = () => { if (!record.uncertain && !record.retiring) {
      record.uncertain=true;stat.uncertain++;uncertainShas.add(target.sha);
      try{persistRuntime();}catch{ledgerHealthy=false;}
    } };
    record.finish = () => { if (!record.finished) {record.finished=true;stat.inFlight--;requests.delete(record);} };
    return record;
  }
  function status() {
    return {version:1,ledgerHealthy,activating:Boolean(activation),active:{generation:active.generation,slot:active.slot,sha:active.sha},slots:[...counts.values()].map(row=>({...row,overdue:[...requests].filter(r=>r.target.sha===row.sha&&Date.now()-r.started>600000).length}))};
  }
  async function activate(generation, sha) {
    if (activation) throw new Error('Activation already in progress');
    activation = (async () => {
      const next = validateGeneration(readPrivate(activeFile),stateDir,options);
      if (next.generation !== generation || next.sha !== sha || next.generation < active.generation) throw new Error('Generation acknowledgement mismatch');
      if (next.generation === active.generation) {
        if (next.sha !== active.sha || next.slot !== active.slot) throw new Error('Generation reused');
        return status();
      }
      await probe(next.target);
      const stillRequested=validateGeneration(readPrivate(activeFile),stateDir,options);
      if(stillRequested.generation!==next.generation||stillRequested.sha!==next.sha||stillRequested.slot!==next.slot)throw new Error('Activation superseded during validation');
      atomicPrivate(path.join(stateDir,'ack.json'),{version:1,generation:next.generation,slot:next.slot,sha:next.sha,acknowledgedAt:new Date().toISOString()});
      active = next; // No await between durable ack and per-request target switch.
      try{persistRuntime();}catch{ledgerHealthy=false;}
      return status();
    })();
    try { return await activation; } finally { activation = null; }
  }
  function retireStreams(sha) {
    if (sha === active.sha) throw new Error('Cannot retire active streams');
    let ended = 0;
    for (const record of requests) if (record.target.sha === sha && record.safeSse) {
      record.retiring = true; record.response.destroy(); record.downstream.end(); record.finish(); ended++;
    }
    return {ended,...status()};
  }
  function fallback(raw, current) {
    for (const id of ['a','b']) {
      try { const slot=readSlot(stateDir,id,options); if(slot.sha!==current.sha) {const asset=staticFile(slot,raw);if(asset)return {...asset,sha:slot.sha};} }
      catch { /* Invalid retained manifests are never a static fallback. */ }
    }
    try{
      const retained=readPrivate(path.join(stateDir,'retained.json'));
      if(retained.version===1&&Array.isArray(retained.releases))for(const record of retained.releases){
        const slot=validateSlot(record,options);if(slot.sha===current.sha)continue;
        const asset=staticFile(slot,raw);if(asset)return {...asset,sha:slot.sha};
      }
    }catch{/* Unverified history is not an asset source. */}
    return null;
  }
  const server = http.createServer((req,res) => {
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) return json(res,400,{error:'Invalid origin path'});
    const target = active.target, record = track(target);
    const upstream = http.request({hostname:'127.0.0.1',port:target.port,method:req.method,path:req.url,headers:endToEnd(req.headers),agent:false},response=>{
      record.response=response;record.downstream=res;
      record.safeSse=req.method==='GET' && req.url.split('?')[0]==='/api/desktop/events' && response.statusCode===200 && String(response.headers['content-type']).startsWith('text/event-stream');
      response.on('error',()=>{if(!record.safeSse||!record.retiring)record.markUncertain();record.finish();if(!res.destroyed)res.destroy();});
      response.on('end',record.finish);
      if (req.method==='GET' && response.statusCode===404) {
        const asset=fallback(req.url,target);
        if (asset) {
          response.resume();
          const stream=fs.createReadStream(asset.file,{flags:fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW});
          stream.on('error',()=>{if(!res.headersSent)json(res,502,{error:'Retained asset unavailable'});else res.destroy();});
          stream.on('open',()=>{res.writeHead(200,{'content-type':mime(asset.file),'content-length':asset.size,'cache-control':'public, max-age=31536000, immutable','x-opscenter-asset-release':asset.sha});stream.pipe(res);});
          return;
        }
      }
      res.writeHead(response.statusCode,{...endToEnd(response.headers),'x-opscenter-release':target.sha});
      if (res.destroyed) response.resume(); else response.pipe(res);
    });
    upstream.on('error',()=>{
      record.markUncertain();record.finish();
      if(!res.headersSent&&!res.destroyed)json(res,502,{code:'origin_response_unknown',error:'Origin response interrupted. Check the saved result before retrying a submitted change.'});
      else if(!res.destroyed)res.destroy();
    });
    req.on('aborted',()=>{record.markUncertain();upstream.destroy();});
    res.on('close',()=>{
      // A submitted write may still finish. Consume its upstream response even
      // when the browser disconnects; never replay or cancel it for that reason.
      if(record.response&&!record.response.complete){record.response.unpipe(res);record.response.resume();}
    });
    req.pipe(upstream);
  });
  server.requestTimeout=0; // No deadline is permission to terminate a write.
  server.headersTimeout=60000; server.keepAliveTimeout=65000;
  server.on('connect',(_req,socket)=>socket.destroy());
  server.on('upgrade',(req,socket,head)=>{
    if(!req.url?.startsWith('/')||req.url.startsWith('//'))return socket.destroy();
    const target=active.target,record=track(target);
    const upstream=http.request({hostname:'127.0.0.1',port:target.port,method:req.method,path:req.url,headers:endToEnd(req.headers,true),agent:false});
    upstream.on('upgrade',(response,peer,upstreamHead)=>{
      const headers=endToEnd(response.headers,true);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers).flatMap(([key,value])=>(Array.isArray(value)?value:[value]).map(item=>`${key}: ${item}\r\n`)).join('')}\r\n`);
      if(upstreamHead.length)socket.write(upstreamHead);if(head.length)peer.write(head);
      socket.pipe(peer);peer.pipe(socket);
      // Arbitrary upgraded protocols may submit work after HTTP completes.
      // Transport is supported; unproven retirement remains blocked.
      const close=()=>{record.markUncertain();record.finish();};
      peer.on('close',close);socket.on('close',()=>{peer.end();close();});
      peer.on('error',()=>socket.destroy());socket.on('error',()=>peer.destroy());
    });
    upstream.on('response',response=>{response.resume();record.finish();socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');});
    upstream.on('error',()=>{record.markUncertain();record.finish();socket.destroy();});
    upstream.end();
  });
  const control=http.createServer(async(req,res)=>{
    try {
      if(req.method==='GET'&&req.url==='/status')return json(res,200,status());
      let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw new Error('Control body limit');}
      const input=JSON.parse(body);
      if(req.method==='POST'&&req.url==='/activate')return json(res,200,await activate(input.generation,input.sha));
      if(req.method==='POST'&&req.url==='/retire-streams')return json(res,200,retireStreams(input.sha));
      return json(res,404,{error:'Unknown control operation'});
    } catch {json(res,409,{error:'Control operation rejected; current routing retained'});}
  });
  control.requestTimeout=5000;control.headersTimeout=5000;
  let shutdownStarted=false;
  async function shutdown(){
    if(shutdownStarted)return;shutdownStarted=true;
    const closed=new Promise(resolve=>server.close(resolve));
    for(const record of requests)if(record.safeSse){record.retiring=true;record.response.destroy();record.downstream.end();record.finish();}
    await closed;
    // Graceful proxy maintenance releases the listener immediately but never
    // terminates submitted upstream work or erases an uncertain result.
    while(true){
      let safe=ledgerHealthy&&[...counts.values()].every(row=>row.inFlight===0&&row.uncertain===0);
      if(safe)for(const id of ['a','b']){
        try{const slot=readSlot(stateDir,id,options);if(slot.retiredAt)continue;const health=await probe(slot,{strict:false,assets:false});if(health.release.pending!==0)safe=false;}
        catch(error){if(error.code!=='ENOENT')safe=false;}
      }
      if(safe){persistRuntime(true);await new Promise(resolve=>control.close(resolve));return;}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }
  return {server,control,status,activate,retireStreams,shutdown};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const stateDir=path.join(DEPLOY_ROOT,'.release-slots'),socket=path.join(stateDir,'control.sock');
  const proxy=await createOriginProxy({stateDir});
  // Never unlink a live or unexpected socket. launchd restart may leave only a
  // dead owned socket; an independently listening control endpoint blocks us.
  if(fs.existsSync(socket)){
    const stat=fs.lstatSync(socket);if(!stat.isSocket()||stat.uid!==process.getuid())throw new Error('Unexpected control socket');
    const net=await import('node:net');
    const alive=await new Promise(resolve=>{const client=net.createConnection(socket);client.once('connect',()=>{client.destroy();resolve(true);});client.once('error',error=>resolve(error.code!=='ECONNREFUSED'));});
    if(alive)throw new Error('Control socket still live or uncertain');fs.unlinkSync(socket);
  }
  try{
    await new Promise((resolve,reject)=>{proxy.control.once('error',reject);proxy.control.listen(socket,resolve);});
    fs.chmodSync(socket,0o600);
    await new Promise((resolve,reject)=>{proxy.server.once('error',reject);proxy.server.listen(3000,'127.0.0.1',resolve);});
    console.log('Origin proxy ready on loopback3000; generation',proxy.status().active.generation);
    for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{void proxy.shutdown().catch(()=>{console.error('Proxy graceful shutdown needs review; process retained.');});});
  }catch(error){console.error('Origin proxy listener failure',error.code||'unknown');proxy.control.close();proxy.server.close();process.exitCode=1;}
}
