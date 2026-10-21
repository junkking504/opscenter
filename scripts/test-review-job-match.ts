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
  write('podium-google-reviews/current.json', {version:1,source:'podium_api',fetchedAt:'2026-10-21T12:00:00Z',locations:[{uid:'test-location',name:'Junk King New Orleans',address:'',averageRating:5,reviewCount:1,reviews:[{uid:'test-review',authorName:'Bill Chowdry',body:'Gene was quick and helpful',rating:5,createdAt:'2026-10-21T12:00:00Z',updatedAt:'2026-10-21T12:00:00Z',needsResponse:true,responseCount:0,url:''}]}]});
  const {readDesktopMarketing, updateDesktopMarketing} = await import('../lib/desktop-marketing');
  const {readPodiumReviewAssignments} = await import('../lib/podium-review-assignments');
  const actor = {email:'test@example.invalid',role:'manager' as const};
  let review = readDesktopMarketing('2026-10-21',actor.role).reviews[0];
  assert.ok(review.candidates[0].label.includes('recorded crew'));
  assert.equal(review.attribution?.status === 'matched',false,'inference must not grant credit');
  for (const reference of ['JK4111111','123456']) {
    const operation = {date:'2026-10-21',action:'review.assign' as const,recordId:review.id,expectedVersion:review.version,requestId:randomUUID(),values:{appointmentId:reference}};
    assert.equal(updateDesktopMarketing(operation,actor).status,'verified');
    assert.equal(updateDesktopMarketing(operation,actor).status,'verified','receipt retry');
    assert.equal(readPodiumReviewAssignments()[0].attribution.appointmentId,'123456');
    review = readDesktopMarketing('2026-10-21',actor.role).reviews[0];
    assert.equal(review.attribution?.status,'matched');
  }
  assert.throws(()=>updateDesktopMarketing({date:'2026-10-21',action:'review.assign',recordId:review.id,expectedVersion:review.version,requestId:randomUUID(),values:{appointmentId:'JK9999999'}},actor),/No completed appointment/);
  console.log('PASS inferred suggestions remain unassigned; JK and numeric saves persist, refresh, and retry safely.');
} finally { fs.rmSync(root,{recursive:true,force:true}); }

}
void main();
