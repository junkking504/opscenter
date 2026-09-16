import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';
import { INSPECTION_SECTIONS } from '../lib/truck-inspection';
import { connectInspectionPhone, submitTruckInspection } from '../lib/truck-inspection-store';
import { inspectionSlackNotification } from '../lib/truck-inspection-notifications';
import { runSlackOpsAlerts } from '../lib/slack-alerts';

async function main() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'inspection-slack-'));
  const oldFetch=globalThis.fetch;
  process.env.OPS_TRUCK_INSPECTION_DIR=path.join(root,'inspections');
  process.env.OPSCENTER_DATA_DIR=root;
  process.env.SLACK_OPSCENTER_STATE_FILE=path.join(root,'state.json');
  process.env.SLACK_OPSCENTER_ALERTS_ENABLED='true';
  process.env.SLACK_BOT_TOKEN='synthetic-token';
  process.env.SLACK_OPS_FLEET_CHANNEL_ID='C_TEST_FLEET';
  const now=new Date('2026-09-16T14:00:00Z');
  mock.timers.enable({apis:['Date'],now});
  try {
    const device=connectInspectionPhone('a'.repeat(64),now).device;
    const input=(truck='Truck 3',startedAt='2026-09-16T12:00:00Z')=>({requestId:randomUUID(),truck,inspector:'Fixture <@everyone>',initials:'FX',odometer:'12345',fuel:'1/2',loadLevel:'3/4',startedAt,answers:INSPECTION_SECTIONS.map(s=>({id:s.id,status:'good' as const,notes:''})),status:'clear' as const,notes:'',photos:[]});
    const report=submitTruckInspection(input(),device,now);
    const late=submitTruckInspection(input('Truck 4','2026-09-15T12:00:00Z'),device,now);
    submitTruckInspection(input('Truck 9','2026-09-15T12:00:00Z'),device,new Date('2026-09-15T13:00:00Z'));
    const alert=inspectionSlackNotification({...report,status:'reported',answers:report.answers.map((a,i)=>({...a,status:i===0?'problem':'good',notes:i===0?'Leak':i===1?'Bent rim':''}))});
    assert.equal(alert.channelId,'C_TEST_FLEET');
    assert.match(alert.plainText!,/Bent rim/);
    assert.match(alert.plainText!,/marked Good/);
    assert.match(alert.plainText!,/&lt;@everyone&gt;/);
    assert.equal(inspectionSlackNotification({...report,status:'stop'}).severity,'critical');
    assert.match(alert.href,/date=2026-09-16&report=/);
    let calls=0; let reject=true;
    globalThis.fetch=async (_url,init)=>{
      calls++; const body=JSON.parse(String(init?.body));
      assert.equal(body.channel,'C_TEST_FLEET');
      assert.match(body.text,/Five Point Inspection Received/);
      if (reject) { reject=false; return new Response(JSON.stringify({ok:false,error:'ratelimited'})); }
      return new Response(JSON.stringify({ok:true,ts:`123.${calls}`}));
    };
    const run=(options={})=>runSlackOpsAlerts({date:'2026-09-16',onlyKinds:['truck_inspection'],...options});
    assert.equal((await run({dryRun:true})).preview.length,2,'Includes late draft, excludes yesterday receipt');
    assert.equal(calls,0); assert.equal(fs.existsSync(process.env.SLACK_OPSCENTER_STATE_FILE!),false);
    process.env.SLACK_OPSCENTER_ALERTS_ENABLED='false'; await run(); assert.equal(calls,0);
    process.env.SLACK_OPSCENTER_ALERTS_ENABLED='true';
    const first=await run(); assert.equal(first.posted.length,1); assert.equal(first.failures.length,1);
    const second=await run(); assert.equal(second.posted.length,1); assert.equal(second.failures.length,0);
    assert.equal(calls,3);
    assert.equal((await run()).posted.length,0); assert.equal(calls,3,'Successful reports never repost');
    assert.equal((await run({date:'2026-09-15'})).preview.length,0);
    const before=fs.readFileSync(process.env.SLACK_OPSCENTER_STATE_FILE!,'utf8');
    assert.equal((await run({date:'2026-09-15'})).posted.length,0);
    assert.equal(fs.readFileSync(process.env.SLACK_OPSCENTER_STATE_FILE!,'utf8'),before);
    const distinct=submitTruckInspection(input(),device,now); assert.notEqual(distinct.requestId,report.requestId);
    assert.equal((await run()).posted.length,1,'A second real report on the same truck has its own identity');
    assert.match(inspectionSlackNotification(late).href,/date=2026-09-15/);
    fs.writeFileSync(process.env.SLACK_OPSCENTER_STATE_FILE!,'broken');
    await assert.rejects(run,/unparseable/);
    const runner=fs.readFileSync('scripts/run-linxup-live-refresh.sh','utf8');
    assert.ok(runner.indexOf('--only truck_inspection')<runner.indexOf('scutil -r'));
    console.log('Inspection Slack checks passed: receipt routing, notes, failure retry, deduplication, late reports, disabled/dry-run and historical silence.');
  } finally { globalThis.fetch=oldFetch;mock.timers.reset();fs.rmSync(root,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
