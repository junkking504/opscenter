import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { askOpsBotApproved, maintenanceSpendingApproved, validateAskOpsBotRequest, validateMaintenanceRequest, assertMeteredFeatureApproved } from '../lib/metered-usage-policy';
import { diagnoseMaintenance } from '../lib/maintenance-diagnosis';
import { initialMaintenanceState, readMaintenanceState, reserveMaintenanceCall, monthKey } from '../lib/maintenance-monitor';

async function main() {
const policy = {version: 1, default: 'deny', paused: false, approvals: {'maintenance-diagnosis': {id: 'maintenance-pilot-20260908', enabled: true, provider: 'openai', model: 'gpt-5.6-luna', monthlyBudgetMicros: 10_000_000}}};
assert(maintenanceSpendingApproved(() => JSON.stringify(policy)));
for (const value of ['{}', '{broken', JSON.stringify({...policy, paused: true}), JSON.stringify({...policy, default: 'allow'})]) {
  assert.equal(maintenanceSpendingApproved(() => value), false);
}
assert.equal(maintenanceSpendingApproved(() => { throw new Error('missing'); }), false);
for (const change of [{model: 'more-expensive-model'}, {monthlyBudgetMicros: 20_000_000}, {enabled: false}, {id: 'invented-approval'}]) {
  assert.equal(maintenanceSpendingApproved(() => JSON.stringify({...policy, approvals: {'maintenance-diagnosis': {...policy.approvals['maintenance-diagnosis'], ...change}}})), false);
}
process.env.GOOGLE_MAPS_API_KEY = 'test-credential';
process.env.OPENAI_API_KEY = 'test-credential';
process.env.AI_ENABLED = '1';
for (const feature of ['google-routes', 'truck-photo-analysis', 'anthropic', 'unknown']) assert.throws(() => assertMeteredFeatureApproved(feature), /approval/);
const request = {model:'gpt-5.6-luna', store:false, service_tier:'default', instructions:'diagnose', input:'measured evidence', max_output_tokens:2048, text:{}};
validateMaintenanceRequest(request);
for (const delta of [{tools:[{type:'web_search'}]}, {service_tier:'priority'}, {model:'another-model'}, {input:[{type:'input_image'}]}, {previous_response_id:'old'}, {max_output_tokens:10000}, {input:'x'.repeat(21000)}]) {
  assert.throws(() => validateMaintenanceRequest({...request,...delta}), /approval/);
}
assert.throws(() => readMaintenanceState('/nonexistent-spending-test-directory'), /paused/);
const corruptDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'spending-ledger-'));
try {
  fs.writeFileSync(path.join(corruptDirectory, 'state.json'), JSON.stringify({...initialMaintenanceState(), months: []}));
  assert.throws(() => readMaintenanceState(corruptDirectory), /paused/, 'Array ledgers must not drop named monthly entries when serialized');
} finally { fs.rmSync(corruptDirectory, {recursive:true, force:true}); }
const state = initialMaintenanceState();
const now = Date.parse('2026-09-09T12:00:00Z');
state.months[monthKey(now)] = {calls:500,committedMicros:1,estimatedMicros:1,inputTokens:1,outputTokens:1};
assert.equal(reserveMaintenanceCall(state, now), false, 'Small cost estimates cannot bypass the monthly call ceiling');
let calls = 0;
await diagnoseMaintenance(state, 'present-key', () => {}, now, (async () => { calls++; throw new Error('must not send'); }) as typeof fetch, () => false);
assert.equal(calls, 0);
assert.match(state.aiStatus, /approval required/);
const opsBotApproval = {id:'ask-opsbot-pilot-20260924',enabled:true,provider:'openai',model:'gpt-6-luna',monthlyBudgetMicros:10_000_000,maxQuestions:50,reserveMicros:200_000,maxOutputTokens:1200,serviceTier:'default',store:false,webSearch:false,fileUploads:false};
const opsBotPolicy = {...policy, approvals:{...policy.approvals,'ask-opsbot':opsBotApproval}};
assert(askOpsBotApproved(() => JSON.stringify(opsBotPolicy)));
for (const change of [{model:'gpt-6-astra'},{monthlyBudgetMicros:20_000_000},{maxQuestions:51},{reserveMicros:100_000},{webSearch:true},{store:true},{enabled:false}]) {
  assert.equal(askOpsBotApproved(() => JSON.stringify({...opsBotPolicy,approvals:{...opsBotPolicy.approvals,'ask-opsbot':{...opsBotApproval,...change}}})),false);
}
const opsBotTools = ['read_daily_operations','read_truck_advisors','search_opscenter','read_source_health'].map(name=>({type:'function',name,description:name,strict:true,parameters:{type:'object',properties:{},required:[],additionalProperties:false}}));
const opsBotRequest = {model:'gpt-6-luna',store:false,service_tier:'default',instructions:'Use evidence.',input:[{role:'user',content:'question'}],max_output_tokens:1200,tools:opsBotTools,tool_choice:'required',parallel_tool_calls:false,reasoning:{effort:'low'}};
validateAskOpsBotRequest(opsBotRequest);
for (const delta of [{model:'gpt-6-astra'},{store:true},{service_tier:'priority'},{max_output_tokens:5000},{tools:[...opsBotTools,{type:'web_search'}]},{tool_choice:'none'},{parallel_tool_calls:true},{previous_response_id:'saved'}]) {
  assert.throws(() => validateAskOpsBotRequest({...opsBotRequest,...delta}), /approval/);
}
console.log('Metered usage policy: missing/corrupt approval, changed budget/model, paid tools, key-only activation and missing history all fail closed.');

}
main().catch(error => { console.error(error); process.exitCode = 1; });
