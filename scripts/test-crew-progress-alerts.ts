import { summarizeAppointmentNotes } from '../lib/appointment-note-summary';
import { consolidateConfirmedVisitAlerts } from '../lib/confirmed-visit-alerts';
import assert from 'node:assert/strict';
import { buildCrewProgress } from '../lib/crew-progress';
import { toOperationalAlert } from '../lib/operational-alert-presentation';
import { deduplicateOperationalUpdates } from '../lib/operational-update-dedup';
import { fetchSlackDailyDigest, type SlackDigestMessage } from '../lib/slack-digest';
import { fixtureSnapshot, job, alert, now } from './fixtures/crew-progress';
import { commandAlertWorkItemForSource } from '../lib/command-alert-workflow';
import { crewPaymentFacts, crewCloseoutFacts, crewAppointmentFacts } from '../lib/crew-progress-details';
import { appointmentPickupItems } from '../lib/junkware-job-details';
import { crewAlertCardPresentation } from '../desktop-ui/lib/crew-alert-presentation';
import type { WorkItem } from '../lib/platform/contracts';

const message = (id:string, timestamp:string, rawText:string, values:Partial<SlackDigestMessage> = {}): SlackDigestMessage => ({id,timestamp,rawText,text:rawText,channel:'#truck-2',threadReply:false,...values});
const legacyClock = toOperationalAlert(message('clock','2026-09-07T00:13:00Z',':bust_in_silhouette: *Krewe clocked out*\n*Krewe member:* Example worker\n*Clock out:* 06:10 PM\n*Hours:* 8.25'));
assert.equal(legacyClock.label,'Clock Out');
assert.equal(legacyClock.title,'Example worker');
assert.equal(legacyClock.facts.find(fact => fact.label === 'Hours')?.value,'8.25');
assert.equal(legacyClock.href,'/crew?date=2026-09-06');
const legacyPay = toOperationalAlert(message('pay','2026-09-07T00:13:00Z','*Final daily pay*\n*Krewe member:* Example worker\n*Total pay:* $210.00\n*Hourly pay:* $180.00\n*Tips:* $20.00\n*Bonuses:* $10.00\n*Other pay:* $0.00'));
assert.equal(legacyPay.label,'Final Daily Pay');
assert.equal(legacyPay.facts.length,6);
assert.equal(legacyPay.needsAction,false);
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
assert.equal(fixture.crewProgress?.jobs.some(job=>job.steps.some(step=>step.label === 'Assignment' || step.label === 'Departure')),false);
assert.deepEqual(fixture.crewProgress?.jobs[0].steps.map(step=>step.label),['Duration','Photos','Payment','Closeout']);
assert.equal(fixture.crewProgress?.jobs[0].needsFollowUp,true);
assert.match(fixture.crewProgress!.jobs[0].next,/No uploaded photos/);
assert.deepEqual(fixture.crewProgress?.jobs[0].updateIds,['closed-one','arrival-one']);
assert.equal(fixture.crewProgress!.jobs[1].steps.filter(step => step.state === 'next').length,1);
assert.match(fixture.crewProgress!.jobs[1].next,/arrival/i);
assert.deepEqual(fixture.crewProgress?.unlinkedUpdateIds,['clock-in']);
const fixtureNewJob = fixture.crewProgress!.jobs.find(job => job.jobNumber === 'JK1000002')!;
assert.deepEqual(crewAlertCardPresentation(fixture.alerts.find(alert => alert.id === 'new-two')!,fixtureNewJob),{
  kind:'new-appointment',label:'New Appointment',territory:'New Orleans',territoryTone:'new-orleans',jobNumber:'JK1000002',timeSlot:'11:00 AM – 12:00 PM',href:fixtureNewJob.href,
});
const cancellationCard = crewAlertCardPresentation(alert('cancel','Cancellation','2026-09-07T15:00:00Z',{title:'JK1000004 · 2:00 PM - 3:00 PM',territory:'Junk King Northshore'}));
assert.equal(cancellationCard?.kind,'cancellation');
assert.equal(cancellationCard?.territory,'Northshore');
assert.equal(cancellationCard?.territoryTone,'northshore');
assert.equal(crewAlertCardPresentation(fixture.alerts.find(alert => alert.id === 'closed-one')!,fixture.crewProgress!.jobs[0])?.label,'Job Completed');
const estimateJob = {...fixture.crewProgress!.jobs[0],status:'Estimate completed'};
assert.equal(crewAlertCardPresentation(alert('estimate-closed','Estimate Closed','2026-09-07T14:08:00Z'),estimateJob)?.label,'Estimate Completed');
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

const visit = {appointment_id:'101',jk_number:'JK1000001',truck_number:'Truck 2',match_confidence:'confirmed',visit_intervals:[{arrival:'2026-09-07T13:00:00Z',departure:'2026-09-07T13:20:00Z'}]};
const departure = (id:string,time:string,reported:string) => ({...toOperationalAlert(message(id,time,`Truck 2 Departure\nJK1000001\n${reported}`)),truck:'Truck 2'});
const reports = [departure('early','2026-09-07T13:05:00Z','8:05 AM'),departure('middle','2026-09-07T13:10:00Z','8:10 AM'),departure('final','2026-09-07T13:21:00Z','8:20 AM')];
const consolidated = consolidateConfirmedVisitAlerts(reports,[visit],now);
assert.equal(consolidated.length,1);
assert.equal(consolidated[0].id,'early');
assert.equal(consolidated[0].corrected,true);
assert.deepEqual(consolidated[0].sourceMessageIds,['early','middle','final']);
assert.equal(consolidated[0].facts.find(fact => fact.label === 'Departure')?.value,'8:20 AM');
assert.equal(consolidated[0].label,'Duration');
assert.equal(consolidated[0].facts.find(fact => fact.label === 'Duration')?.value,'20 min');
const priorReview = {...reviewed,entity:{id:'middle'}} as WorkItem;
assert.equal(commandAlertWorkItemForSource([priorReview],consolidated[0]),priorReview,'A review on a provisional departure survives consolidation');
assert.equal(consolidateConfirmedVisitAlerts([...reports,{...reports[0],id:'reply',threadReply:true}],[visit],now).length,2,'Thread replies remain separate');
assert.equal(consolidateConfirmedVisitAlerts(reports,[],now).length,3,'No confirmed evidence means preserve all reports');
assert.equal(consolidateConfirmedVisitAlerts(reports,[{...visit,pass_by_only:true}],now).length,3);
assert.equal(consolidateConfirmedVisitAlerts(reports,[{...visit,visit_intervals:[{arrival:'2026-09-07T13:00:00Z'}]}],now).length,3,'Open visit cannot validate a departure');
const second = {...visit,visit_intervals:[{arrival:'2026-09-07T14:00:00Z',departure:'2026-09-07T14:20:00Z'}]};
assert.equal(consolidateConfirmedVisitAlerts([...reports,departure('return','2026-09-07T14:21:00Z','9:20 AM')],[visit,second],now).length,2,'A real return visit remains separate');
assert.equal(consolidateConfirmedVisitAlerts(reports,[visit,{...visit,appointment_id:'ambiguous'}],now).length,3,'Ambiguous visit identity must remain separate');
assert.equal(consolidateConfirmedVisitAlerts(reports,[{...visit,visit_intervals:[],visit_count:2,first_arrival:visit.visit_intervals[0].arrival,final_departure:visit.visit_intervals[0].departure}],now).length,3,'First and final timestamps cannot collapse multiple visits without intervals');
assert.equal(consolidateConfirmedVisitAlerts(reports,[{...visit,truck_number:'Truck 3'}],now).length,3,'Different truck evidence cannot establish a revision');
const arrivalReport = toOperationalAlert(message('arrival','2026-09-07T13:01:00Z','Truck 2 Arrival\nJK1000001\n8:00 AM'));
const wholeVisit = consolidateConfirmedVisitAlerts([arrivalReport,...reports],[visit],now);
assert.equal(wholeVisit.length,1,'Arrival and departure become one Duration alert');
assert.equal(wholeVisit[0].id,'arrival');
assert.deepEqual(wholeVisit[0].sourceMessageIds,['arrival','early','middle','final']);
assert.equal(consolidateConfirmedVisitAlerts([arrivalReport],[{...visit,visit_intervals:[{arrival:'2026-09-07T13:00:00Z'}]}],now)[0].label,'Arrival','Arrival remains visible until a departure is confirmed');
assert.equal(consolidateConfirmedVisitAlerts([arrivalReport],[visit],now)[0].label,'Duration','A confirmed departure updates the arrival even before the Slack departure arrives');
const tenderJob = job({closeout:{...job().closeout!,tip:25,payments:[{method:'Check',detail:'Check #00127',amount:100},{method:'Credit Card',detail:'4111111111114242',amount:375}]}});
assert.deepEqual(crewPaymentFacts(tenderJob),[{label:'Check #00127',value:'$100.00'},{label:'Credit Card · ending 4242',value:'$375.00'},{label:'Tips',value:'$25.00'}]);
assert.doesNotMatch(JSON.stringify(crewPaymentFacts(tenderJob)),/411111111111/);
assert.equal(crewPaymentFacts(job()).some(fact=>fact.label === 'Tips'),false,'Zero tips do not add an empty field');
assert.deepEqual(crewCloseoutFacts(job({closeout:{...job().closeout!,otherCharges:[{name:'Mattress fee',quantity:2,unitPrice:20,total:40}]}})),[{label:'Load',value:'Half truck · $450.00'},{label:'2 × Mattress fee',value:'$40.00'}]);
const description = '2 king bed frames, one ceramic fountain and 14 bags';
assert.deepEqual(appointmentPickupItems({job_description:description}),[description],'Original item descriptions retain quantities and unrecognized items');
const customer = crewAppointmentFacts(job({customerEmail:'customer@example.test',phone:'555-010-0200',pickupItems:[description],appointmentNotes:['Use side gate.','Call before arrival.']}));
assert.equal(customer.find(fact=>fact.label === 'Pickup items')?.value,description);
assert.equal(customer.find(fact=>fact.label === 'Key notes')?.value,'Use side gate. · Call before arrival.');
assert.equal(customer.find(fact=>fact.label === 'Email')?.href,'mailto:customer@example.test');
assert.deepEqual(summarizeAppointmentNotes([
  'Two beds in separate bedrooms. (9/5/2026 11:29:47 AM , Operator)',
  'Customer called asking for an ETA. Sent a franchise notification. (9/5/2026 2:05:26 PM , Operator)',
  'Appointment moved from 09/05/2026, 12:00 PM to 09/06/2026, 08:00 AM.',
  'TOG–Junk King Customer Care Case Type: ETA/Status Resolution: Resolved Call Summary: I confirmed the appointment. The caller accepted the information and had no further requests. Action Details: ETA notification sent requesting callback between 8 and 10.',
  'Customer called to confirm ETA, sent notification to team so they can call her to confirm the ETA, she is aware and agreed to wait.',
  'Use side gate. Call 30 minutes before arrival.',
  'Use side gate.',
]), ['Two beds in separate bedrooms.', 'Use side gate.', 'Call 30 minutes before arrival.', 'Customer contacted the call center for an ETA.']);
assert.deepEqual(summarizeAppointmentNotes(['Customer called for an ETA. Please leave the piano upstairs.']), ['Please leave the piano upstairs.', 'Customer requested an ETA.']);
assert.deepEqual(summarizeAppointmentNotes(['Additional Lead Note Label: Website Note: What will be picking up?: 12 bags and a fountain, Service Type: Residential, Special Offer: boilerplate']), ['12 bags and a fountain']);
assert.deepEqual(summarizeAppointmentNotes(['Do not remove the cabinet. Gate code 0012.', 'No elevator; use rear stairs.']), ['Do not remove the cabinet.', 'Gate code 0012.', 'No elevator; use rear stairs.']);
assert.deepEqual(summarizeAppointmentNotes(['TOG–Junk King Customer Care Case Type: ETA/Status Resolution: Resolved Call Summary: The caller requested an update on their scheduled appointment because the pickup window was past due. I checked the appointment details and attempted to contact the team for an update but was forwarded to voicemail and could not provide a confirmed status. I spoke with the team to inquire about the issue and apologized to the caller. I provided an explanation but did not complete any request or confirm a resolution. Next Steps: Follow up needed to address the caller’s issue or request.', 'Customer requested to cancel. Nobody showed up.']), ['Customer requested to cancel.', 'Nobody showed up.', 'Customer contacted the call center for an ETA.']);
assert.deepEqual(summarizeAppointmentNotes(['The caller acknowledged the information. I acknowledged the caller’s request to have someone return their call. The caller mentioned needing a callback before their plans in two hours. Next Steps: Await callback from the appropriate department as requested by the caller.']), ['The caller mentioned needing a callback before their plans in two hours.']);
assert.deepEqual(summarizeAppointmentNotes(['I acknowledged the caller’s request to have someone return their call.']), ['Customer requested a callback.']);
assert.deepEqual(summarizeAppointmentNotes(['Cash $100.00 Remove', 'Do not remove the piano.']), ['Do not remove the piano.']);


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
