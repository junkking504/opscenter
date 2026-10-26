import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { commandAlertWorkItemForSource } from '../lib/command-alert-workflow';
import { mergeInspectionTimeline } from '../lib/truck-inspection-updates';
import { toOperationalAlert } from '../lib/operational-alert-presentation';
import type { OperationalAlert } from '../lib/operational-alert-presentation';

let slackAvailable = false;
const date='2026-10-26', id=`truck_inspection:${date}:${'a'.repeat(64)}`;
const entry:OperationalAlert={id,eventFingerprint:id,label:'Inspection Submitted',title:'Fixture inspector',truck:'Truck 9',source:'OpsCenter inspections',timestamp:date+'T12:34:00Z',detected:'7:34 AM',domain:'Fleet',owner:'Fleet',needsAction:true,facts:[{label:'Reported status',value:'Do not operate'}],next:'Do not operate. Supervisor review required.',href:'/fleet-inspections?date='+date,sourceMessageIds:['C123:123.456']};
let authorized=true, complete=true, entries=[entry], saved:any, conflict=false;
const dependencies:Record<string,unknown>={
  '@/lib/truck-inspection-updates':{mergeInspectionTimeline,readInspectionTimeline:(requested:string)=>{assert.equal(requested,date);return {alerts:entries,complete};}},
  '@/lib/streamlined-operational-alerts':{}, '@/lib/desktop-schedule-source':{}, '@/lib/command-cancellations':{}, '@/lib/confirmed-visit-alerts':{}, '@/lib/desktop-schedule-visits':{},
  'next/server':{NextResponse:Response},
  '@/lib/command-alert-workflow':{COMMAND_ALERT_RULE:'test',commandAlertWorkItemForSource},
  '@/lib/linxup-geofence-alerts':{}, '@/lib/operational-alert-presentation':{toOperationalAlert}, '@/lib/combined-closeout-alerts':{}, '@/lib/auth':{}, '@/lib/command-crew-corrections':{}, '@/lib/slack-closeout-details':{}, '@/lib/payment-reconciliation':{},
  '@/lib/slack-digest':{readSlackDailyDigest:()=>{if(!slackAvailable)throw Error('Slack unavailable');return {status:'ready',complete:false,messages:[{id:'C123:123.456',eventFingerprint:id,timestamp:entry.timestamp,channel:'#ops-fleet',text:'Five Point Inspection Received',rawText:'Five Point Inspection Received'}]};}},
  '@/lib/platform/identifiers':{createCorrelationId:()=> 'test'},
  '@/lib/platform/request-actor':{authenticatedPlatformActor:async()=>authorized?{id:'fixture',displayName:'Fixture'}:null},
  '@/lib/platform/persistence/work-items':{
    listCommandAlertWorkItems:async()=>[{entity:{id:'C123:123.456'},status:'acknowledged'}],
    saveCommandAlertWorkItem:async(input:unknown,options:unknown)=>{if(conflict)throw Error('WORK_ITEM_VERSION_CONFLICT');saved={input,options};return {id:'saved'};},
  },
};
const compiled=ts.transpileModule(fs.readFileSync(new URL('../app/api/command/alert-workflow/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const handlers:{POST?:(request:Request)=>Promise<Response>}={};
new Function('require','exports',compiled)((name:string)=>{assert(name in dependencies,`Unexpected dependency: ${name}`);return dependencies[name];},handlers);
const request=(action='acknowledge',alertId=id)=>new Request('https://example.invalid/api/command/alert-workflow',{method:'POST',body:JSON.stringify({date,alertId,action,expectedVersion:3,facts:[{label:'forged',value:'ignored'}]})});
async function main(){
  for(const action of ['acknowledge','add_to_control']) {
    assert.equal((await handlers.POST!(request(action))).status,200);
    assert.equal(saved.input.source,'OpsCenter inspections');
    assert.equal(saved.input.sourceObservedAt,entry.timestamp);
    assert.equal(saved.input.entity.id,'C123:123.456','Reuse historical Slack workflow ownership');
    assert.match(saved.input.description,/Do not operate/);assert.doesNotMatch(saved.input.description,/forged/);
    assert.equal(saved.options.action,action);assert.equal(saved.options.expectedVersion,3);
  }
  entries=[{...entry,sourceMessageIds:[]}];slackAvailable=true;
  assert.equal((await handlers.POST!(request())).status,200);
  assert.equal(saved.input.entity.id,'C123:123.456','Recover existing ownership from partial Slack history after delivery-ledger loss/pruning');
  entries=[entry];slackAvailable=false;
  assert.equal((await handlers.POST!(request('acknowledge',id+'bad'))).status,404);
  entries=[];assert.equal((await handlers.POST!(request())).status,404);
  complete=false;assert.equal((await handlers.POST!(request())).status,503);
  entries=[entry];assert.equal((await handlers.POST!(request())).status,200,'Known source still actionable during partial history');
  conflict=true;assert.equal((await handlers.POST!(request())).status,409);
  authorized=false;assert.equal((await handlers.POST!(request())).status,401);
  console.log('PASS inspection workflow: native source validation, Slack failure fallback, pruned-ledger recovery, auth, review/follow-up, aliases, version conflicts and unavailable source.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
