import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-job-match-'));
process.env.OPSBOT_DATA_DIR = root;
process.env.PODIUM_REVIEW_ASSIGNMENT_STORE = path.join(root, 'operator', 'assignments.json');
process.env.OPSCENTER_DESKTOP_COMMERCIAL_DIR = path.join(root, 'receipts');
const write = (file: string, data: unknown) => { const dest = path.join(root, file); fs.mkdirSync(path.dirname(dest), {recursive:true}); fs.writeFileSync(dest, JSON.stringify(data)); };
async function main() {
try {
  write('processed/daily_metrics_2026-10-20.json', {appointments:[{appt_id:'123456',job_id:'JK4111111',customer_name:'William Chowdhury',job_status:'Completed',territory:'New Orleans',driver_name:'Eugene Test'}]});
  write('podium-google-reviews/current.json', {version:1,source:'podium_api',fetchedAt:'2026-10-21T12:00:00Z',locations:[{uid:'test-location',name:'Junk King New Orleans',address:'',averageRating:5,reviewCount:1,reviews:[{uid:'test-review',authorName:'Bill Chowdry',body:'Thanks to Gene for being quick and helpful',rating:5,createdAt:'2026-10-21T12:00:00Z',updatedAt:'2026-10-21T12:00:00Z',needsResponse:true,responseCount:0,url:''}]}]});
  const metricsFile = path.join(root,'processed/daily_metrics_2026-10-20.json');
  const metrics = JSON.parse(fs.readFileSync(metricsFile,'utf8'));
  for (const [index, name] of ['Mike','Luke','Dave','Evan','Sean','Jake','William','Don','Guy','Max','Joy','Miles','Jack'].entries()) metrics.appointments.push({appt_id:String(900000+index),job_id:`JK900000${index}`,customer_name:'Synthetic Other',job_status:'Completed',territory:'New Orleans',driver_name:`${name} Test`});
  fs.writeFileSync(metricsFile,JSON.stringify(metrics));
  const {buildPodiumReviewNameSuggestionMap} = await import('../lib/podium-review-attribution');
  const input = {uid:'crew-inference', authorName:'Anonymous',createdAt:'2026-10-21T12:00:00Z',locationName:'Junk King New Orleans'};
  for (const body of ['They have gone above and beyond', "Don't hesitate, I don't regret hiring them", "Don’t hesitate", 'Nice guy, gave max effort, a joy to work with, drove miles to jack up the couch', 'eugene was great', 'Will use again, great genes', 'I would like to say they will make it easy, have a nice day, even better than I had seen']) {
    assert.ok(buildPodiumReviewNameSuggestionMap(root,[{...input,body}])[input.uid].every(candidate => !candidate.evidence.includes('Possible crew mention') && candidate.confidence === 'Low'),body);
  }
  for (const body of ['Eugene was great', 'Thanks to Gene for the help']) {
    assert.equal(buildPodiumReviewNameSuggestionMap(root,[{...input,body}])[input.uid][0]?.matchKind,'crew_mention',body);
  }
  assert.ok(buildPodiumReviewNameSuggestionMap(root,[{...input,body:'Eugene was great',locationName:'Junk King Baton Rouge'}])[input.uid].every(candidate => candidate.confidence !== 'High'), 'Timing may support crew evidence across locations, but never grants High without identity');
  const {readDesktopMarketing, updateDesktopMarketing} = await import('../lib/desktop-marketing');
  const {readPodiumReviewAssignments} = await import('../lib/podium-review-assignments');
  const actor = {email:'test@example.invalid',role:'manager' as const};
  let review = readDesktopMarketing('2026-10-21',actor.role).reviews[0];
  assert.ok(review.candidates[0].label.includes('Possible crew mention'));
  assert.equal(review.attribution?.status === 'matched',false,'inference must not grant credit');
  for (const reference of ['JK4111111','123456']) {
    const operation = {date:'2026-10-21',action:'review.assign' as const,recordId:review.id,expectedVersion:review.version,requestId:randomUUID(),values:{appointmentId:reference}};
    assert.equal(updateDesktopMarketing(operation,actor).status,'verified');
    assert.equal(updateDesktopMarketing(operation,actor).status,'verified','receipt retry');
    assert.equal(readPodiumReviewAssignments()[0].attribution.appointmentId,'123456');
    review = readDesktopMarketing('2026-10-21',actor.role).reviews[0];
    assert.equal(review.attribution?.status,'matched');
  }
  const possible = {date:'2026-10-21',action:'review.assign' as const,recordId:review.id,expectedVersion:review.version,requestId:randomUUID(),values:{appointmentId:'123456',confidence:'possible',evidenceNote:'Same first name and territory; different surname. Source appointment checked.'}};
  const receipt = updateDesktopMarketing(possible,actor);
  assert.equal(receipt.status,'verified');
  assert.equal(receipt.input?.confidence,'possible');
  assert.equal(receipt.input?.evidenceNote,possible.values.evidenceNote);
  review = readDesktopMarketing('2026-10-21',actor.role).reviews[0];
  assert.equal(review.attribution?.status,'ambiguous');
  assert.equal(review.attribution?.appointmentId,'123456');
  assert.equal(review.attribution?.evidenceNote,possible.values.evidenceNote);
  const {buildPodiumGoogleReviewsView} = await import('../lib/podium-reviews');
  assert.equal(buildPodiumGoogleReviewsView().employeeTallies30Days.length,0);
  const {readTvSpotlights}=await import('../lib/tv-spotlights');
  const card=readTvSpotlights('2026-10-21',actor.role).cards.find(row=>row.id==='review-test-review');
  assert.equal(card?.credit,'Possible match · Eugene Test');
  assert.equal(card?.attributionContext,possible.values.evidenceNote);
  assert.equal(updateDesktopMarketing(possible,actor).status,'verified','same receipt retries without upgrading possible evidence');
  assert.throws(()=>updateDesktopMarketing({...possible,requestId:randomUUID(),values:{...possible.values,evidenceNote:'changed'}},actor),/record changed/i);
  for (const values of [{appointmentId:'123456',confidence:'possible'}, {appointmentId:'123456',confidence:'invalid'}, {appointmentId:'123456',confidence:['confirmed']}, {appointmentId:'123456',evidenceNote:'x'.repeat(2001)}]) {
    assert.throws(()=>updateDesktopMarketing({...possible,requestId:randomUUID(),expectedVersion:review.version,values},actor),/confidence/);
  }
  assert.equal(readPodiumReviewAssignments()[0].attribution.status,'ambiguous','invalid writes preserve the prior decision');
  const confirmed = {...possible,requestId:randomUUID(),expectedVersion:review.version,values:{...possible.values,confidence:'confirmed',evidenceNote:'Identity verified against source records.'}};
  assert.equal(updateDesktopMarketing(confirmed,actor).status,'verified');
  review=readDesktopMarketing('2026-10-21',actor.role).reviews[0];
  assert.equal(review.attribution?.status,'matched');
  assert.equal(review.attribution?.evidenceNote,confirmed.values.evidenceNote);
  assert.equal(buildPodiumGoogleReviewsView().employeeTallies30Days.length,1,'confirmed assignment receives credit in the same snapshot');
  const creditedCard=readTvSpotlights('2026-10-21',actor.role).cards.find(row=>row.id==='review-test-review');
  assert.equal(creditedCard?.credit,'Eugene Test');
  assert.equal(creditedCard?.attributionContext,confirmed.values.evidenceNote);
  assert.throws(()=>updateDesktopMarketing({date:'2026-10-21',action:'review.assign',recordId:review.id,expectedVersion:review.version,requestId:randomUUID(),values:{appointmentId:'JK9999999'}},actor),/No completed appointment/);
  console.log('PASS inferred suggestions remain unassigned; JK and numeric saves persist, refresh, and retry safely.');
} finally { fs.rmSync(root,{recursive:true,force:true}); }

}
void main();
