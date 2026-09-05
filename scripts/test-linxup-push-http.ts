import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { pendingLinxupPushes } from '../lib/linxup-push-queue';

async function main() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'opscenter-push-http-test-'));
  const socket=net.createServer(); socket.listen(0,'127.0.0.1'); await once(socket,'listening');
  const port=(socket.address() as net.AddressInfo).port; await new Promise<void>(resolve=>socket.close(()=>resolve()));
  const bot=path.join(root,'bot'); const data=path.join(root,'data');
  const lock=path.join(bot,'tmp','linxup_live_refresh.lock');
  fs.mkdirSync(lock,{recursive:true}); fs.mkdirSync(path.join(data,'config'),{recursive:true});
  fs.writeFileSync(path.join(data,'config','linxup_vehicle_map.json'),JSON.stringify({mappings:[{
    status:'active',effective_start_date:'2020-01-01',linxup_tracker_id:'fixture-v2',linxup_vehicle_name:'Fixture Truck',junkware_truck_number:'2',
  }]}));
  const env={...process.env,OPSCENTER_DATA_DIR:data,OPSBOT_DIR:bot,OPSCENTER_DIR:process.cwd(),LINXUP_PUSH_BEARER_TOKEN:'isolated-test-token',SLACK_OPSCENTER_ALERTS_ENABLED:'false'};
  const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:'ignore'});
  try {
    const url=`http://127.0.0.1:${port}/api/integrations/linxup/push`;
    let ready=false;
    for(let i=0;i<100;i++) {try{const r=await fetch(url);if(r.status===405){ready=true;break;}}catch{} await delay(100);}
    assert.ok(ready,'Isolated receiver started');
    const payload={date:Date.now()-1000,latitude:30,longitude:-90,tracker:{name:'Fixture Truck',trackerId:'fixture-v3'}};
    const post=(value:unknown,token='isolated-test-token')=>fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(value)});
    assert.equal((await post(payload,'wrong')).status,401);
    assert.equal((await post({})).status,422);
    assert.equal((await post({...payload,tracker:{name:'Unknown'}})).status,422);
    const response=await post(payload);assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,accepted:true,queued:true,processed:false});
    await delay(300);
    assert.equal(pendingLinxupPushes(data).length,1,'Busy lock must retain acknowledged update');
    assert.equal((await post(payload)).status,200);
    assert.equal(pendingLinxupPushes(data).length,1,'HTTP retry must not duplicate pending update');
    // Simulated restart recovery uses the real normalizer, without GPS/Slack
    // side effects: no production data directories or credentials are used.
    server.kill('SIGTERM'); await once(server,'exit');
    fs.rmdirSync(lock);
    const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/drain-linxup-push.ts'],{env}).toString());
    assert.equal(result.processed,1);assert.equal(result.remaining,0);
    console.log('Isolated HTTP receiver passed: auth, validation, busy-lock acknowledgement, duplicate retry, and restart recovery.');
  } finally {
    if(server.exitCode===null && server.signalCode===null){server.kill('SIGTERM');await once(server,'exit');}
    fs.rmSync(root,{recursive:true,force:true});
  }
}
void main();
