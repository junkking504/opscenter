import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {trackedGeofenceVisits} from '../lib/linxup-geofence-alerts';
import {runUnloadCostAgent} from '../lib/unload-cost-agent';
import {defaultDumpFeePolicy} from '../lib/dump-expenses';
import {runOperationalAgents} from '../lib/operational-agents';
import {readTruckAgentInputs} from '../lib/truck-agent-inputs';
import {assessTruck} from '../lib/truck-agent-rules';
const date='2026-09-17',at=(clock:string)=>`${date}T${clock}-05:00`,now=Date.parse(at('14:00:00'));
const visits=trackedGeofenceVisits(date,[],[
  {alert_type:'geofence_entered',occurred_at:at('09:29:25'),geofence_name:'BR Landfilll',truck_number:'6'},
  {alert_type:'geofence_exited',occurred_at:at('09:48:44'),geofence_name:'BR Landfilll',truck_number:'6'},
],now);
const expense={id:'a'.repeat(32),date,market:'477',truck:'Truck# 6',kind:'dump' as const,transactionAt:at('09:28:00'),location:'Ebr',receipt:'',amount:80,notify:false};
const early=runUnloadCostAgent(date,visits,[expense],defaultDumpFeePolicy,now);
assert.equal(early.actualTotal,80);assert.equal(early.assumedTotal,47);assert.equal(early.total,null);assert.equal(early.needsReviewCount,2);
assert.equal(early.records.length,2,'Ambiguous near-arrival receipt is not automatically merged');
const confirmed=runUnloadCostAgent(date,visits,[expense],defaultDumpFeePolicy,now,[{date,expenseId:expense.id,visitId:visits[0].id,confirmedAt:at('10:00:00'),confirmedBy:'manager@example.com',note:'Crew confirmed the receipt belongs to this visit.'}]);
assert.equal(confirmed.records.length,1);assert.equal(confirmed.records[0].status,'actual');assert.equal(confirmed.total,80);
assert.deepEqual(early.unloads,runUnloadCostAgent(date,visits,[],defaultDumpFeePolicy,now).unloads,'Receipt never changes physical unload timing');
for(const other of [{...expense,truck:'Truck# 8'},{...expense,location:'Stranco'},{...expense,transactionAt:at('09:24:24')},{...expense,location:''}])assert.equal(runUnloadCostAgent(date,visits,[other],defaultDumpFeePolicy,now).needsReviewCount,0,'Only bounded named-site/same-truck ambiguity is flagged');
assert.equal(runUnloadCostAgent(date,visits,[{...expense,transactionAt:at('09:29:25')}],defaultDumpFeePolicy,now).records.length,1,'Exact onsite receipt still reconciles');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-fixes-'));
process.env.OPSCENTER_DATA_DIR=root;process.env.OPSBOT_DATA_DIR=root;process.env.OPS_TRUCK_INSPECTION_DIR=path.join(root,'inspections');
try {
  const tracking={agentId:'visit-tracking' as const,date,visits,sourceHealth:{},complete:true};
  const state=runOperationalAgents(date,{now,readTracking:()=>({result:tracking,watermarks:{gps:now}}),readExpenses:()=>({expenses:[expense],watermarks:{expenses:now}})});
  assert.equal(state.agents['unload-cost'].status,'degraded');
  const input=readTruckAgentInputs(date,now);assert.equal(input.costs.available,true);assert.equal(input.costs.data.length,2);
  assert.equal(assessTruck(6,date,input,now).recommendations.filter(r=>r.rule==='receipt').length,2);
  const file=path.join(root,'fleet/agents',`${date}.json`);
  for(const status of ['error','stale_inputs'] as const){state.agents['unload-cost'].status=status;fs.writeFileSync(file,JSON.stringify(state));assert.equal(readTruckAgentInputs(date,now).costs.available,false);}
  state.agents['unload-cost'].status='degraded';
  for(const dependency of ['retained','unavailable'] as const){state.agents['unload-cost'].dependency=dependency;fs.writeFileSync(file,JSON.stringify(state));assert.equal(readTruckAgentInputs(date,now).costs.available,false);}
  console.log('Agent audit regressions passed: timing ambiguity, receipt propagation, retained/error evidence, and unchanged unload identity.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
