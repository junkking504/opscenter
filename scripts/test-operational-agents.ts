import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {runOperationalAgents} from '../lib/operational-agents';
import {trackedGeofenceVisits} from '../lib/linxup-geofence-alerts';
import type {TruckExpense} from '../lib/truck-expense-notifications';
const date='2026-09-15',at=(clock:string)=>`${date}T${clock}:00-05:00`,now=Date.parse(at('23:00'));
const visits=trackedGeofenceVisits(date,[{truck_number:'4',occurred_at:at('13:49'),geofence_name:'Gentilly'},{truck_number:'4',occurred_at:at('14:15'),geofence_name:'Warehouse'}],[],now);
const tracking={agentId:'visit-tracking' as const,date,visits,sourceHealth:{alerts:'failed',positionsObservedAt:at('14:15')},complete:false};
const actual:TruckExpense={id:'a'.repeat(32),date,market:'352',truck:'Truck# 4',kind:'dump',transactionAt:at('17:00'),location:'Gentillt',receipt:'',amount:70,notify:false};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'operational-agents-')),previous=process.env.OPSCENTER_DATA_DIR;
process.env.OPSCENTER_DATA_DIR=root;
try {
  const first=runOperationalAgents(date,{now,readTracking:()=>({result:tracking,watermarks:{gps:10,appointments:10}}),readExpenses:()=>({expenses:[],watermarks:{expenses:10}})});
  assert.equal(first.agents['visit-tracking'].status,'degraded','Failed V2 does not prevent local V3 tracking');
  assert.equal(first.agents['unload-cost'].result?.total,44);assert.equal(first.agents['unload-cost'].result?.unloads.length,1);
  const second=runOperationalAgents(date,{now:now+1000,readTracking:()=>({result:tracking,watermarks:{gps:10,appointments:10}}),readExpenses:()=>({expenses:[actual],watermarks:{expenses:11}})});
  assert.equal(second.agents['unload-cost'].result?.actualTotal,70,'Later actual reconciles while GPS watermark unchanged');
  assert.deepEqual(second.agents['unload-cost'].result?.unloads,first.agents['unload-cost'].result?.unloads);
  const retained=runOperationalAgents(date,{now:now+2000,readTracking:()=>{throw new Error('synthetic tracking failure');},readExpenses:()=>({expenses:[{...actual,amount:75}],watermarks:{expenses:12}})});
  assert.equal(retained.agents['visit-tracking'].status,'error');assert.equal(retained.agents['unload-cost'].dependency,'retained');assert.equal(retained.agents['unload-cost'].result?.total,75,'Expense agent independently reconciles against retained visits');
  const costFailure=runOperationalAgents(date,{now:now+3000,readTracking:()=>({result:tracking,watermarks:{gps:11,appointments:12}}),readExpenses:()=>{throw new Error('synthetic expense failure');}});
  assert.equal(costFailure.agents['visit-tracking'].lastSuccessAt,new Date(now+3000).toISOString());assert.equal(costFailure.agents['unload-cost'].status,'error');assert.equal(costFailure.agents['unload-cost'].result?.total,75);
  const stale=runOperationalAgents(date,{now:now+4000,readTracking:()=>({result:{...tracking,visits:[]},watermarks:{gps:9,appointments:11}}),readExpenses:()=>({expenses:[],watermarks:{expenses:11}})});
  assert.equal(stale.agents['visit-tracking'].status,'stale_inputs');assert.equal(stale.agents['unload-cost'].status,'stale_inputs');assert.equal(stale.agents['unload-cost'].result?.total,75);
  assert.equal(runOperationalAgents(date,{now:now-1000}).updatedAt,stale.updatedAt,'An older run cannot overwrite newer observations');
  const file=path.join(root,'fleet','agents',`${date}.json`);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.readdirSync(path.dirname(file)).filter(name=>name.includes('.tmp')).length,0);
  const lockedRoot=path.join(root,'locked-run');fs.mkdirSync(lockedRoot,{recursive:true});
  execFileSync('/usr/bin/python3',['-c',`import fcntl, os, pathlib, subprocess, sys
root=pathlib.Path(sys.argv[1]); checkout=pathlib.Path(sys.argv[2]); d=root/'fleet'/'agents'; d.mkdir(parents=True)
env=dict(os.environ,OPSCENTER_DATA_DIR=str(root))
with open(d/'worker.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 result=subprocess.run(['/usr/bin/python3',str(checkout/'scripts/run-operational-agents.py'),'${date}'],env=env,check=True,capture_output=True)
 assert not (d/'${date}.json').exists()
subprocess.run(['/usr/bin/python3',str(checkout/'scripts/run-operational-agents.py'),'${date}'],env=env,check=True,capture_output=True)
assert (d/'${date}.json').exists()
`,lockedRoot,process.cwd()],{timeout:30_000});
  const refresh=fs.readFileSync('scripts/run-linxup-live-refresh.sh','utf8');assert.ok(refresh.indexOf('\nrun_operational_agents\n')<refresh.indexOf('if ! /usr/sbin/scutil'),'Minute agents execute before network checks');
  assert.match(fs.readFileSync('scripts/run-linxup-push.sh','utf8'),/trap run_operational_agents EXIT/,'Accepted V3 processing runs agents even if later matching fails');
  console.log('Operational agent runner passed: independent failures, retained visits, late actuals, monotonic evidence, OS lock, atomic private files, and UI-independent refresh hooks.');
} finally {if(previous===undefined)delete process.env.OPSCENTER_DATA_DIR;else process.env.OPSCENTER_DATA_DIR=previous;fs.rmSync(root,{recursive:true,force:true});}
