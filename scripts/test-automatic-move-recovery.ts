import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-auto-move-'));
  process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR = dir;
  process.env.JOB_ROUTE_ASSIGNMENTS_FILE = path.join(dir, 'assignments.json');
  const { automaticallyCheckMove, scheduleMoveRecovery, readScheduleReceipt } = await import('../lib/desktop-schedule-operations');
  const { saveJobRouteAssignment, readJobRouteAssignmentOverrides } = await import('../lib/job-route-assignments');
  const { assignmentNeedsVerification } = await import('../desktop-ui/lib/schedule-contract');
  const date = '2026-09-14', actor = 'synthetic-operator';
  let serial = 100;
  const seed = async (error = 'JunkWare dispatch preflight: this appointment was not found on its saved day. No move was submitted.', status = 'uncertain') => {
    const appointmentId = String(serial++), requestId = randomUUID();
    const assignment = saveJobRouteAssignment({date, jobKey:`appt:${appointmentId}`, appointmentId, truck:'Truck 9', appointmentStartMinutes:900, appointmentEndMinutes:960, junkwareSyncStatus:'manual_correction', junkwareSyncError:error})!;
    const receipt = {requestId, actor, action:'move', date, recordId:`${date}:appointment:${appointmentId}`, fingerprint:'synthetic', status, updatedAt:new Date().toISOString(), message:error, sourceResult:{assignment}};
    await fs.writeFile(path.join(dir, requestId+'.json'), JSON.stringify(receipt));
    return {receipt, source:{appointmentId, date, truck:'Truck 8', appointmentStartMinutes:660, appointmentEndMinutes:720, verifiedAt:new Date().toISOString()}};
  };
  try {
    const first = await seed();
    await fs.writeFile(path.join(dir, randomUUID()+'.json'), '{broken');
    assert.equal((await scheduleMoveRecovery(date, actor)).candidate, first.receipt.requestId, 'Normal refresh finds an old stuck move');
    assert.equal((await scheduleMoveRecovery(date, 'other')).candidate, null);
    assert.equal((await scheduleMoveRecovery('2026-09-15', actor)).candidate, null);
    let reads = 0;
    await Promise.all(Array.from({length:3}, () => automaticallyCheckMove(first.receipt.requestId, actor, async () => { reads++; return first.source; })));
    assert.equal(reads, 1, 'Concurrent tabs reserve one source read');
    const result = (await readScheduleReceipt(first.receipt.requestId))!;
    assert.equal(result.status, 'failed');
    assert.equal(result.sourceResult?.assignmentReconciled, true);
    assert.equal((result.sourceResult?.assignment as {truck:string}).truck, 'Truck 9', 'Attempt stays in audit');
    const restored = readJobRouteAssignmentOverrides(date).get('appt:'+first.source.appointmentId)!;
    assert.equal(restored.truck, 'Truck 8');
    assert.equal(restored.appointmentStartMinutes, 660);
    assert.equal(assignmentNeedsVerification(restored), false, 'Fresh snapshot enables dragging');
    assert.equal((await scheduleMoveRecovery(date, actor)).notices.length, 1);
    saveJobRouteAssignment({...restored, truck:'Truck 4'});
    assert.equal((await scheduleMoveRecovery(date, actor)).notices.length, 0, 'Old failure notice cannot describe a later move');

    for (const scenario of ['unavailable','unknown','other-day','stale','future','invalid-window','newer-override','newer-same-target','pending','wrong-actor','matching']) {
      const {receipt, source} = await seed(scenario==='unknown'?'Response lost':undefined, scenario==='pending'?'pending':'uncertain');
      if (scenario==='newer-override') saveJobRouteAssignment({...receipt.sourceResult.assignment, truck:'Truck 3'});
      if (scenario==='newer-same-target') {
        receipt.sourceResult.assignment.updatedAt = new Date(Date.now()-60_000).toISOString();
        await fs.writeFile(path.join(dir,receipt.requestId+'.json'),JSON.stringify(receipt));
      }
      const checked = await automaticallyCheckMove(receipt.requestId, scenario==='wrong-actor'?'other':actor, async () => {
        if (scenario==='unavailable') throw new Error('Source unavailable');
        return {...source, ...(['matching','newer-same-target'].includes(scenario)?{truck:'Truck 9',appointmentStartMinutes:900,appointmentEndMinutes:960}:{}), ...(scenario==='other-day'?{date:'2026-09-15'}:{}), ...(scenario==='stale'?{verifiedAt:new Date(Date.now()-120_000).toISOString()}:{}), ...(scenario==='future'?{verifiedAt:new Date(Date.now()+120_000).toISOString()}:{}), ...(scenario==='invalid-window'?{appointmentEndMinutes:0}:{})};
      });
      assert.equal(checked?.status, scenario==='wrong-actor'?undefined:scenario==='matching'?'verified':scenario==='pending'?'pending':'uncertain', scenario);
      if (scenario==='unavailable') {
        let retries=0;
        await automaticallyCheckMove(receipt.requestId, actor, async () => {retries++;return source;});
        assert.equal(retries,0,'Cooldown survives a new caller after failed source read');
        for (let attempt=1;attempt<=3;attempt++) {
          const current = (await readScheduleReceipt(receipt.requestId))!;
          await fs.writeFile(path.join(dir,receipt.requestId+'.json'),JSON.stringify({...current,automaticMoveCheck:{attempts:attempt,checkedAt:new Date(Date.now()-6*60_000).toISOString()}}));
          await automaticallyCheckMove(receipt.requestId,actor,async()=>{retries++;throw new Error('Unavailable');});
        }
        assert.equal(retries,2,'Automatic source reads stop after three durable attempts');
      }
    }
    console.log('Automatic move recovery passed: refresh discovery, one concurrent read, source restoration, drag unlock, audit/notices, cooldown/budget, exact match, and unavailable/unknown/date/freshness/race/actor guards. No source writes.');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
}
void main();
