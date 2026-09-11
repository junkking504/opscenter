import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRecyclingSlackAlerts, deliverRecyclingSlackAlerts } from '../lib/recycling-slack';
import { writeRecyclingData } from '../lib/recycling-receipt-store';
import type { RecyclingRecord } from '../desktop-ui/lib/commercial-contract';
import type { RecyclingReceiptDraft } from '../desktop-ui/lib/recycling-receipts';

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recycling-slack-test-'));
  process.env.OPSCENTER_DESKTOP_COMMERCIAL_DIR = directory;
  process.env.SLACK_OPSCENTER_ALERTS_ENABLED = 'true';
  process.env.SLACK_BOT_TOKEN = 'synthetic';
  process.env.SLACK_OPS_PAYMENT_CHANNEL_ID = 'payment-fixture';
  const calls: { channel: string; text: string; ts?: string }[] = [];
  const send = async (_token: string, channel: string, text: string, ts?: string) => { calls.push({channel,text,ts}); return {ok:true,ts:ts || '123.456'}; };
  const draft: RecyclingReceiptDraft = {id:'statement',version:'1',receivedAt:'2026-09-11T12:00:00Z',updatedAt:'2026-09-11T12:00:00Z',status:'review',photos:[],yard:'Synthetic Yard <@all>',rows:[],total:100,warnings:[]};
  const record = (id: string, date: string, amount: number): RecyclingRecord => ({id,version:'1',statementId:'statement',date,material:'Metal',sourceJob:'',yard:draft.yard,quantity:'',expectedValue:null,realizedValue:amount,ticket:id,paymentReference:'Cash receipt',status:'Paid',paymentDate:'2026-09-11',owner:'',note:'',updatedAt:draft.updatedAt});
  try {
    writeRecyclingData({schemaVersion:1,records:[],receiptDrafts:[draft]});
    const preview = await deliverRecyclingSlackAlerts({dryRun:true,send});
    assert.equal(preview.preview.length,1); assert.equal(calls.length,0);
    assert.equal(fs.existsSync(path.join(directory,'slack-deliveries.json')),false);
    assert.equal((await deliverRecyclingSlackAlerts({send})).posted,1);
    assert.match(calls[0].text,/Needs Review/); assert.match(calls[0].text,/&lt;@all&gt;/);
    assert.equal(calls[0].channel,'payment-fixture');
    assert.equal((await deliverRecyclingSlackAlerts({send})).unchanged,1);
    draft.status='recorded';
    const records=[record('first','2026-08-04',40),record('second','2026-08-31',60)];
    writeRecyclingData({schemaVersion:1,records,receiptDrafts:[draft]});
    assert.equal((await deliverRecyclingSlackAlerts({send})).updated,1);
    assert.equal(calls[1].ts,'123.456'); assert.match(calls[1].text,/Recorded run value:\* \$100.00/);
    assert.match(calls[1].text,/2026-08-04: \$40.00/); assert.match(calls[1].text,/2026-09-11/);
    assert.equal(buildRecyclingSlackAlerts({schemaVersion:1,records,receiptDrafts:[draft]}).length,1);
    assert.equal((await deliverRecyclingSlackAlerts({send})).unchanged,1);
    records[0].realizedValue=50;
    writeRecyclingData({schemaVersion:1,records});
    assert.equal((await deliverRecyclingSlackAlerts({send:async()=>({ok:false,error:'rate_limited'})})).failures.length,1);
    assert.equal((await deliverRecyclingSlackAlerts({send})).updated,1);
    fs.writeFileSync(path.join(directory,'.slack-delivery-lock'),String(process.pid));
    assert.equal((await deliverRecyclingSlackAlerts({send})).skipped,true);
    fs.unlinkSync(path.join(directory,'.slack-delivery-lock'));
    fs.writeFileSync(path.join(directory,'slack-deliveries.json'),'broken');
    await assert.rejects(deliverRecyclingSlackAlerts({send}));
    assert.equal(calls.length,3);
    console.log('Recycling Slack: grouped receipt, review-to-recorded update, payment date, escaping, dedupe, retry, lock, and corrupt-state checks passed.');
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
