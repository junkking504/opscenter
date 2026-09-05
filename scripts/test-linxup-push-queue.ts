import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { drainLinxupPushes, enqueueLinxupPush, InvalidLinxupPush, pendingLinxupPushes, linxupPushQueueStatus } from '../lib/linxup-push-queue';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'opscenter-push-queue-test-'));
try {
  fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config','linxup_vehicle_map.json'),JSON.stringify({mappings:[{
    status:'active',effective_start_date:'2020-01-01',linxup_tracker_id:'synthetic-v2',linxup_vehicle_name:'Test Truck',junkware_truck_number:'2',
  }]}));
  const payload={date:Date.now()-60_000,latitude:30,longitude:-90,tracker:{trackerId:'synthetic-v3',name:'Test Truck'}};
  const raw=JSON.stringify(payload);
  assert.throws(()=>enqueueLinxupPush('{}',root),InvalidLinxupPush);
  assert.throws(()=>enqueueLinxupPush(JSON.stringify({...payload,tracker:{name:'Unknown'}}),root),InvalidLinxupPush);
  assert.throws(()=>enqueueLinxupPush(JSON.stringify({...payload,date:Date.now()+600_000}),root),InvalidLinxupPush);
  enqueueLinxupPush(raw,root);
  assert.equal(enqueueLinxupPush(raw,root).duplicate,true);
  assert.equal(pendingLinxupPushes(root).length,1);
  const queued=pendingLinxupPushes(root)[0];
  assert.equal(fs.statSync(queued.file).mode&0o777,0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(queued.file,'utf8')),payload);

  // Simulate a busy polling lock with the real shell runner. Nothing is lost.
  const bot=path.join(root,'opsbot');
  fs.mkdirSync(path.join(bot,'tmp','linxup_live_refresh.lock'),{recursive:true});
  execFileSync('/bin/bash',['scripts/run-linxup-push.sh','--drain'],{env:{...process.env,OPSBOT_DIR:bot,OPSCENTER_DIR:process.cwd(),OPSCENTER_DATA_DIR:root}});
  assert.equal(pendingLinxupPushes(root).length,1);
  const failed=drainLinxupPushes(root,()=>{throw new Error('Transient failure');});
  assert.equal(failed.failed,1);
  assert.equal(failed.remaining,1);

  // A new process recovers durable state, using the real normalizer.
  const invoke=()=>JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/drain-linxup-push.ts'],{env:{...process.env,OPSCENTER_DATA_DIR:root}}).toString());
  const result=invoke();
  assert.equal(result.processed,1);
  assert.equal(result.remaining,0);
  fs.rmdirSync(path.join(bot,'tmp','linxup_live_refresh.lock'));
  execFileSync('/bin/bash',['scripts/run-linxup-push.sh','--drain'],{env:{...process.env,OPSBOT_DIR:bot,OPSCENTER_DIR:process.cwd(),OPSCENTER_DATA_DIR:root,SLACK_OPSCENTER_ALERTS_ENABLED:'true'}});
  assert.equal(fs.existsSync(path.join(bot,'tmp','linxup_live_refresh.lock')),false,'Empty drain must release its lock without invoking downstream actions');
  const date=result.dates[0];
  const snapshotPath=path.join(root,'history','linxup',`linxup_location_${date}.json`);
  let snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8'));
  assert.equal(snapshot.points.length,1);
  assert.equal(snapshot.points[0].received_at,new Date(queued.receivedAt).toISOString());
  assert.equal(snapshot.points[0].timestamp,new Date(payload.date).toISOString());
  enqueueLinxupPush(raw,root); invoke();
  snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8'));
  assert.equal(snapshot.points.length,1,'Provider retries must not duplicate GPS observations');
  enqueueLinxupPush(JSON.stringify({...payload,date:payload.date-1000}),root); invoke();
  snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8'));
  assert.equal(snapshot.delivery.v3_position_push.latest_position_at,new Date(payload.date).toISOString(),'Out-of-order processing cannot regress newest position metadata');

  enqueueLinxupPush(raw,root);
  enqueueLinxupPush(JSON.stringify({...payload,date:payload.date-2000}),root);
  let calls=0;
  const partial=drainLinxupPushes(root,()=>{if(++calls===1)throw new Error('Failure');return date;});
  assert.equal(partial.processed,1);
  assert.equal(partial.remaining,1,'A failed entry stays pending without blocking other trucks');
  assert.equal(linxupPushQueueStatus(root).pending,1);
  fs.writeFileSync(snapshotPath,'invalid');
  assert.equal(invoke().failed,1);
  assert.equal(fs.readFileSync(snapshotPath,'utf8'),'invalid','A corrupt snapshot cannot be silently overwritten');
  assert.equal(pendingLinxupPushes(root).length,1);
  console.log('Push queue passed: validation, private durable storage, exact-name mapping, duplicate delivery, lock contention, restart recovery, failure isolation, receipt timestamps, and out-of-order replay.');
} finally {fs.rmSync(root,{recursive:true,force:true});}
