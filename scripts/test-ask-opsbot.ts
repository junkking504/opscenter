import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeAskOpsBotLedger, readAskOpsBotLedger, reserveAskOpsBotQuestion, settleAskOpsBotQuestion } from '../lib/ask-opsbot-ledger';
import { runAskOpsBot } from '../lib/ask-opsbot-agent';

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-opsbot-ledger-'));
  try {
    assert.throws(() => readAskOpsBotLedger(directory), /paused/);
    initializeAskOpsBotLedger(directory, Date.parse('2026-09-24T12:00:00Z'));
    assert.deepEqual(readAskOpsBotLedger(directory), {available:true,used:0,remaining:50,limit:50,monthlyBudgetMicros:10_000_000,reservedMicros:0,paused:false});
    const first = reserveAskOpsBotQuestion('actor-hash', directory, Date.parse('2026-09-24T12:01:00Z'));
    settleAskOpsBotQuestion(first, {inputTokens:1_000,outputTokens:200}, directory, Date.parse('2026-09-24T12:02:00Z'));
    const firstRecord = JSON.parse(fs.readFileSync(first.file, 'utf8'));
    assert.equal(firstRecord.month, '2026-09');
    assert.equal(firstRecord.estimatedMicros, 200);
    const uncertain = reserveAskOpsBotQuestion('actor-hash', directory);
    settleAskOpsBotQuestion(uncertain, null, directory);
    assert.equal(JSON.parse(fs.readFileSync(uncertain.file, 'utf8')).status, 'unavailable');
    for (let index = 2; index < 50; index += 1) reserveAskOpsBotQuestion('actor-hash', directory);
    assert.deepEqual(readAskOpsBotLedger(directory), {available:false,used:50,remaining:0,limit:50,monthlyBudgetMicros:10_000_000,reservedMicros:10_000_000,paused:false});
    assert.throws(() => reserveAskOpsBotQuestion('actor-hash', directory), /complete/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }

  const requests: Array<Record<string, unknown>> = [];
  let call = 0;
  const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body || '{}')));
    call += 1;
    if (call === 1) return new Response(JSON.stringify({
      output:[{type:'function_call',name:'read_source_health',call_id:'call-1',arguments:'{}'}],
      usage:{input_tokens:100,output_tokens:20},
    }), {status:200,headers:{'Content-Type':'application/json'}});
    return new Response(JSON.stringify({
      output:[{type:'message',content:[{type:'output_text',text:'JunkWare is current as of 10:00 AM.'}]}],
      usage:{input_tokens:150,output_tokens:30},
    }), {status:200,headers:{'Content-Type':'application/json'}});
  }) as typeof fetch;
  const result = await runAskOpsBot('Is JunkWare current?', '2026-09-24', 'manager', 'test-key', mockFetch, () => ({
    output:{checkedAt:'2026-09-24T15:00:00Z',sources:[{name:'JunkWare',state:'Current',observedAt:'2026-09-24T15:00:00Z'}]},
    sources:[{label:'JunkWare',detail:'Current · 2026-09-24T15:00:00Z'}],
  }));
  assert.equal(result.answer, 'JunkWare is current as of 10:00 AM.');
  assert.deepEqual(result.usage, {inputTokens:250,outputTokens:50});
  assert.equal(result.sources[0].label, 'JunkWare');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, 'gpt-6-luna');
  assert.equal(requests[0].store, false);
  assert.equal(requests[0].service_tier, 'default');
  assert.equal(requests[0].tool_choice, 'required');
  assert.match(JSON.stringify(requests[0].tools), /read_financial_reconciliation/);
  assert.match(JSON.stringify(requests[0].tools), /read_crew_pay/);
  assert.equal(requests[1].tool_choice, 'auto');
  assert.match(JSON.stringify(requests[1].input), /function_call_output/);
  assert(!JSON.stringify(requests).includes('web_search'));
  console.log('Ask OpsBot: approval shape, durable 50-question ledger, bounded tool loop, sources, and token accounting passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
