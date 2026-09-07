import assert from 'node:assert/strict';
import { buildCrewProgress } from '../lib/crew-progress';
import { deduplicateOperationalUpdates } from '../lib/operational-update-dedup';
import { fetchSlackDailyDigest, type SlackDigestMessage } from '../lib/slack-digest';
import { fixtureSnapshot, job, alert, now } from './fixtures/crew-progress';
import { commandAlertWorkItemForSource } from '../lib/command-alert-workflow';
import type { WorkItem } from '../lib/platform/contracts';

const message = (id:string, timestamp:string, rawText:string, values:Partial<SlackDigestMessage> = {}): SlackDigestMessage => ({id,timestamp,rawText,text:rawText,channel:'#truck-2',threadReply:false,...values});
const first = message('first','2026-09-07T13:00:00Z','Arrival\nJK1000001\n_Alert ID: arrival:101:visit_one_');
const retry = {...first,id:'retry',timestamp:'2026-09-07T13:01:00Z',channel:'#dispatch'};
const distinct = {...first,id:'second-visit',timestamp:'2026-09-07T16:00:00Z',rawText:first.rawText.replace('visit_one','visit_two')};
const recovered = {...first,id:'reply',timestamp:'2026-09-07T14:00:00Z',threadReply:true,rawText:'Resolved\n_Alert ID: arrival:101:visit_one_'};
let updates = deduplicateOperationalUpdates([retry,first,distinct,recovered]);
assert.equal(updates.length,3,'Retry collapses, second visit and recovery remain');
assert.deepEqual(updates.find(update => update.id === 'first')?.sourceMessageIds,['first','retry']);
assert.equal(updates.find(update => update.id === 'first')?.corrected,false);
updates = deduplicateOperationalUpdates([first,{...retry,rawText:retry.rawText.replace('Arrival','Arrival corrected')}]);
assert.equal(updates[0].id,'first');
assert.equal(updates[0].corrected,true);
assert.match(updates[0].rawText,/corrected/);
updates = deduplicateOperationalUpdates([{...first,rawText:'Corrected arrival',updatedAt:'2026-09-07T17:00:00Z',eventFingerprint:'arrival:101:visit_one'},retry]);
assert.equal(updates[0].rawText,'Corrected arrival','A later retry must not replace a newer in-place correction');
assert.equal(deduplicateOperationalUpdates([message('a',first.timestamp,'Photos Uploaded\nJK1000001'),message('b',retry.timestamp,'Photos Uploaded\nJK1000001')]).length,2,'Unidentified photo batches cannot be safely merged');
const fixture = fixtureSnapshot();
assert.equal(fixture.crewProgress?.jobs.length,3);
assert.equal(fixture.crewProgress?.jobs[0].needsFollowUp,true);
assert.match(fixture.crewProgress!.jobs[0].next,/No uploaded photos/);
assert.deepEqual(fixture.crewProgress?.jobs[0].updateIds,['arrival-one','closed-one','departure-one']);
assert.equal(fixture.crewProgress!.jobs[1].steps.filter(step => step.state === 'next').length,1);
assert.match(fixture.crewProgress!.jobs[1].next,/arrival/i);
assert.deepEqual(fixture.crewProgress?.unlinkedUpdateIds,['clock-in']);
const build = (appointments:Parameters<typeof buildCrewProgress>[0]['appointments'], options:Partial<Parameters<typeof buildCrewProgress>[0]> = {}) => buildCrewProgress({date:'2026-09-07',appointments,alerts:[],visits:[],scheduleCurrent:true,visitsCurrent:true,updatesComplete:true,now,...options});
const step = (snapshot:ReturnType<typeof build>,label:string) => snapshot.jobs[0].steps.find(step => step.label === label)!;
const stale = build([job()],{scheduleCurrent:false,visitsCurrent:false,updatesComplete:false});
assert.equal(stale.jobs[0].needsFollowUp,false,'Stale source must not assert missing steps');
assert.equal(step(stale,'Photos').state,'unknown');
assert.equal(step(stale,'Closeout').state,'complete','Known historical evidence is retained');
assert.equal(step(build([job({photoAuditAvailable:false})]),'Photos').state,'unknown');
assert.equal(step(build([job({appointmentType:'Estimate'})]),'Payment').state,'not-required');
assert.equal(step(build([job({closeout:{...job().closeout!,balance:50,payments:[{method:'Cash',detail:'',amount:400}]}})]),'Payment').state,'missing');
assert.equal(step(build([job({status:'Canceled'})]),'Appointment').state,'not-required');
assert.equal(build([job({status:'Canceled'})]).jobs[0].needsFollowUp,false);
assert.equal(step(build([job()],{visits:[{appointment_id:'101',truck_number:9,match_confidence:'confirmed',first_arrival:'2026-09-07T13:00:00Z'}]}),'Arrival').state,'unknown','Wrong truck is not proof of arrival');
assert.equal(step(build([job()],{visits:[{appointment_id:'101',truck_number:2,match_confidence:'confirmed',first_arrival:'2026-09-07T23:00:00Z'}]}),'Arrival').state,'unknown','Future visit is not evidence');
const ambiguous = build([job(),job({appointmentId:'other',appointmentType:'Estimate'})],{alerts:[alert('ambiguous','Arrival','2026-09-07T13:00:00Z')]});
assert.deepEqual(ambiguous.unlinkedUpdateIds,['ambiguous']);
assert.equal(build([job(),job()]).jobs.length,1,'Repeated schedule copies are one appointment');
const reviewed = {entity:{id:'first'},status:'acknowledged',version:2} as WorkItem;
const owned = {entity:{id:'retry'},status:'in_progress',ownerActorId:'operator',version:4} as WorkItem;
assert.equal(commandAlertWorkItemForSource([reviewed,owned],{id:'first',sourceMessageIds:['first','retry']}),owned,'An owned follow-up survives a duplicate review mark');
assert.equal(commandAlertWorkItemForSource([owned,reviewed],{id:'first',sourceMessageIds:['first','retry']}),owned,'Read and write selection cannot depend on database row order');

async function main() {
  // All Slack calls are intercepted; no token, network or provider is used.
  const digest = await fetchSlackDailyDigest('2026-09-07',{token:'xoxb-fixture',channelIds:['a','b'],appointments:[],completedRows:[],fetchImpl:async input => {
    const url = new URL(String(input));
    return Response.json(url.searchParams.get('channel') === 'a' ? {ok:true,messages:[]} : {ok:false,error:'channel_not_found'});
  }});
  assert.equal(digest.status,'ready');
  assert.equal(digest.complete,false,'One readable channel cannot imply a complete history');
  const replies = await fetchSlackDailyDigest('2026-09-07',{token:'xoxb-fixture',channelIds:['a'],appointments:[],completedRows:[],fetchImpl:async input => {
    const url = new URL(String(input));
    return Response.json(url.pathname.endsWith('/conversations.history') ? {ok:true,messages:[{ts:String(Date.parse('2026-09-07T13:00:00Z')/1000),text:'Arrival\nJK1000001',reply_count:1}]} : {ok:false,error:'ratelimited'});
  }});
  assert.equal(replies.complete,false,'Unavailable thread replies cannot imply a complete history');
  console.log('Crew progress passed: milestones, evidence gaps, stale sources, partial history, retries, corrections, repeated visits, and ambiguous appointment identity.');
}
void main().catch(error => {console.error(error);process.exitCode=1;});
