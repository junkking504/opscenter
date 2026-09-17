import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { commandCancellationAlerts, cancellationAlertId } from '../lib/command-cancellations';
import { streamlineOperationalAlerts } from '../lib/streamlined-operational-alerts';
import { commandAlertWorkItemForSource } from '../lib/command-alert-workflow';
import type { WorkItem } from '../lib/platform/contracts';
import { job } from './fixtures/crew-progress';

const date = '2026-09-07';
const canceled = job({status:'Canceled', completedAt:'', cancellationReason:'Customer changed plans'});
const fallback = streamlineOperationalAlerts([], [canceled], date)[0];
assert.equal(fallback.id, cancellationAlertId(date, canceled.appointmentId));
assert.equal(fallback.label, 'Cancellation', 'Opening baseline cancellations remain visible without Slack');
assert.equal(fallback.source, 'JunkWare');
assert.equal(fallback.timestamp, undefined, 'Do not fabricate event time from appointment or collection time');
assert.equal(fallback.detected, 'Time unavailable');
assert.ok(fallback.facts.some(f => f.label === 'Reason' && f.value === 'Customer changed plans'));
assert.equal(commandCancellationAlerts([], [canceled,canceled], date).length, 1);
assert.equal(commandCancellationAlerts([], [{...canceled,status:'Cancelled'}], date).length, 1);
assert.equal(commandCancellationAlerts([], [{...canceled,status:'Confirmed'}], date).length, 0, 'Restored appointments disappear from fallback');
assert.equal(commandCancellationAlerts([], [{...canceled,sourceDate:'2026-09-06'}], date).length, 0);
assert.equal(commandCancellationAlerts([], [{...canceled,appointmentId:''}], date).length, 0);

const message = {...fallback,id:'SLACK:123',source:'Slack',timestamp:'2026-09-07T13:15:00Z',detected:'8:15 AM'};
const delivered = commandCancellationAlerts([message], [canceled], date);
assert.equal(delivered.length, 1, 'Late delivery replaces fallback without a duplicate');
assert.equal(delivered[0].id, message.id);
assert.equal(delivered[0].timestamp, message.timestamp);
assert.ok(delivered[0].sourceMessageIds?.includes(fallback.id));
assert.equal(message.sourceMessageIds, undefined, 'Do not mutate cached source messages');
const reviewed = {entity:{id:fallback.id},status:'acknowledged'} as WorkItem;
assert.equal(commandAlertWorkItemForSource([reviewed], delivered[0]), reviewed, 'Review follows fallback into Slack entry');
assert.equal(commandCancellationAlerts(delivered, [canceled], date).length, 1, 'Repeated reads remain stable');
const legacy = {...message,href:`/jobs?date=${date}#job-jk1000001`};
assert.equal(commandCancellationAlerts([legacy], [canceled], date).length, 1);
assert.equal(commandCancellationAlerts([legacy], [canceled,{...canceled,appointmentId:'102'}], date).length, 3, 'Ambiguous JK alone cannot suppress either appointment');
assert.equal(commandCancellationAlerts([{...message,href:`/desktop?date=${date}&appointment=102`}], [canceled], date).length, 2);
assert.equal(commandCancellationAlerts([{...legacy,href:'/jobs?date=2026-09-06#job-jk1000001'}], [canceled], date).length, 2);
assert.equal(commandCancellationAlerts([{...message,threadReply:true}], [canceled], date).length, 2, 'A thread reply cannot hide a cancellation');

// Exercise the real workflow HTTP handler with isolated auth, source and store.
let authorized = true, currentJobs = [canceled], observedAt: string | null = '2026-09-07T14:00:00Z';
let saved: Record<string, unknown> | undefined;
const dependencies: Record<string, unknown> = {
  '@/lib/streamlined-operational-alerts': {streamlineOperationalAlerts},
  '@/lib/desktop-schedule-source': {readJobRows:()=>currentJobs,junkwareScheduleUpdatedAt:()=>observedAt},
  '@/lib/command-cancellations': {commandCancellationAlerts},
  '@/lib/confirmed-visit-alerts': {}, '@/lib/desktop-schedule-visits': {},
  'next/server': {NextResponse:Response},
  '@/lib/command-alert-workflow': {COMMAND_ALERT_RULE:'test',commandAlertWorkItemForSource},
  '@/lib/linxup-geofence-alerts': {}, '@/lib/operational-alert-presentation': {},
  '@/lib/combined-closeout-alerts': {}, '@/lib/auth': {}, '@/lib/command-crew-corrections': {},
  '@/lib/slack-closeout-details': {}, '@/lib/payment-reconciliation': {},
  '@/lib/slack-digest': {readSlackDailyDigest:()=>{throw Error('Cancellation actions must work without Slack');}},
  '@/lib/platform/identifiers': {createCorrelationId:()=> 'test'},
  '@/lib/platform/request-actor': {authenticatedPlatformActor:async()=>authorized?{id:'test',displayName:'Test'}:null},
  '@/lib/platform/persistence/work-items': {listCommandAlertWorkItems:async()=>[],saveCommandAlertWorkItem:async(input: Record<string,unknown>)=>{saved=input;return {id:'saved'};}},
};
const compiled = ts.transpileModule(fs.readFileSync(new URL('../app/api/command/alert-workflow/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const handlers: {POST?:(request:Request)=>Promise<Response>} = {};
new Function('require','exports',compiled)((name:string)=>{assert(name in dependencies,`Unexpected dependency: ${name}`);return dependencies[name];},handlers);
const request = (alertId = fallback.id) => new Request('https://example.invalid/api/command/alert-workflow',{method:'POST',body:JSON.stringify({date,alertId,action:'acknowledge',expectedVersion:0})});
async function main() {
  assert.equal((await handlers.POST!(request())).status, 200);
  assert.equal(saved?.source,'JunkWare');
  assert.equal(saved?.sourceObservedAt,observedAt, 'Audit observation time stays separate from cancellation event time');
  saved = undefined;
  assert.equal((await handlers.POST!(request(cancellationAlertId(date,'999')))).status,404);
  currentJobs = [{...canceled,status:'Confirmed'}];
  assert.equal((await handlers.POST!(request())).status,404, 'Re-read source status before accepting a review');
  assert.equal(saved,undefined);
  currentJobs = [canceled]; observedAt = null;
  assert.equal((await handlers.POST!(request())).status,503);
  authorized = false;
  assert.equal((await handlers.POST!(request())).status,401);
  console.log('Command cancellation regression passed: missing notifications, late delivery, source identities, unknown time, restored appointments, and authenticated review source checks.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
