import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DesktopAppointment } from '../lib/desktop-schedule';
import { executeScheduleOperation, finishScheduleCrewAssignment, parseScheduleOperation } from '../lib/desktop-schedule-operations';
import { readCrewDispatch, releaseCrewJob } from '../lib/crew-dispatch-store';
import { readPhotoResponse } from '../app/crew-jobs/photo-response';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-crew-assignment-'));
  process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR = path.join(root, 'operations');
  process.env.OPS_CREW_DISPATCH_DIR = path.join(root, 'crew');
  process.env.OPS_CREW_TRUCK_SWITCH_DIR = path.join(root, 'switches');
  process.env.JOB_ROUTE_ASSIGNMENTS_FILE = path.join(root, 'assignments.json');
  const date = '2026-09-22', actor = 'test-manager', truck = 'Truck 6';
  const jobs = ['901', '902', '903', '904', '905'].map(appointmentId => ({appointmentId, recordId:`${date}:appointment:${appointmentId}`, version:'a'.repeat(64), truck, status:'Confirmed', jkNumber:`SAMPLE-${appointmentId}`, customerName:`Synthetic ${appointmentId}`, address:'Synthetic address', appointmentTime:'4 PM–5 PM', junkItems:[], appointmentNotes:[], driver:'', navigator:''}));
  let writes = 0;
  const operation = (index: number, assignCrew?: boolean) => parseScheduleOperation({requestId:randomUUID(), date, recordId:jobs[index].recordId, expectedVersion:jobs[index].version, action:'move', values:{truck, ...(assignCrew === undefined ? {} : {assignCrew})}});
  const save = async () => { writes++; return {status:200, body:{ok:true}}; };
  try {
    for (const flag of [undefined, true, false]) {
      const move = operation(0, flag);
      const receipt = await executeScheduleOperation(move, actor, () => jobs[0] as unknown as DesktopAppointment, save);
      assert.equal(receipt.status, 'verified');
      assert.equal(receipt.crewAssignment, undefined, 'Neither current nor older tabs may implicitly release a job');
      await finishScheduleCrewAssignment(move.requestId, actor);
      assert.equal(readCrewDispatch(truck).version, 0, 'A move and receipt read leave Waypoint untouched');
      const before = writes;
      await executeScheduleOperation(move, actor, () => jobs[0] as unknown as DesktopAppointment, save);
      assert.equal(writes, before, 'Retry must not repeat the source write');
    }
    releaseCrewJob({truck, requestId:randomUUID(), expectedVersion:0, appointmentId:'901', date}, actor);
    releaseCrewJob({truck, requestId:randomUUID(), expectedVersion:1, appointmentId:'902', date}, actor);
    const fullQueue = readCrewDispatch(truck);
    const third = operation(2, true);
    assert.equal((await executeScheduleOperation(third, actor, () => jobs[2] as unknown as DesktopAppointment, save)).status, 'verified', 'Full Waypoint queue cannot block truck scheduling');
    assert.deepEqual(readCrewDispatch(truck), fullQueue, 'Existing current and queued releases must survive a move');

    // Seed old receipts to exercise restart recovery across the behavior change.
    const legacy = operation(3, true);
    const saved = await executeScheduleOperation(legacy, actor, () => jobs[3] as unknown as DesktopAppointment, save);
    const old = {...saved, crewAssignment:{truck:'Truck 4', expectedVersion:0, state:'pending', message:'Old implicit release'}};
    fs.writeFileSync(path.join(process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR, `${legacy.requestId}.json`), JSON.stringify(old));
    const recovered = await Promise.all([finishScheduleCrewAssignment(legacy.requestId, actor), finishScheduleCrewAssignment(legacy.requestId, actor)]);
    assert.ok(recovered.every(receipt => receipt?.crewAssignment?.state === 'attention'));
    assert.equal(readCrewDispatch('Truck 4').version, 0, 'Reading old pending receipts cannot create a release');

    const crash = operation(4, true);
    const crashReceipt = await executeScheduleOperation(crash, actor, () => jobs[4] as unknown as DesktopAppointment, save);
    fs.writeFileSync(path.join(process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR, `${crash.requestId}.json`), JSON.stringify({...crashReceipt, crewAssignment:{...old.crewAssignment, truck:'Truck 5'}}));
    releaseCrewJob({truck:'Truck 5', requestId:crash.requestId, expectedVersion:0, appointmentId:'905', date}, actor);
    assert.equal((await finishScheduleCrewAssignment(crash.requestId, actor))?.crewAssignment?.state, 'assigned', 'An existing durable release is recovered honestly');
    assert.equal(readCrewDispatch('Truck 5').version, 1, 'Recovery cannot replay a release');

    await assert.rejects(readPhotoResponse(new Response('<html>Gateway timeout</html>', {status:504})), /Photo service/);
    await assert.rejects(readPhotoResponse(Response.json({error:'Reconnect this phone.'}, {status:401})), /Reconnect/);
    assert.deepEqual(await readPhotoResponse(Response.json({photos:[]})), {photos:[]});
    assert.deepEqual(await readPhotoResponse(Response.json({error:'Not found'}, {status:404})), {error:'Not found'});
    console.log('Truck scheduling stays independent of Waypoint: current/legacy clients, full queue, exact retries, pending legacy receipts and crash recovery passed. No live writes.');
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
}
void main();
