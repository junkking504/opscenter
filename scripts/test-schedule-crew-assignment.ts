import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DesktopAppointment } from '../lib/desktop-schedule';
import { executeScheduleOperation, finishScheduleCrewAssignment, parseScheduleOperation } from '../lib/desktop-schedule-operations';
import { readCrewDispatch, releaseCrewJob } from '../lib/crew-dispatch-store';
import type { CrewDispatchSources } from '../lib/crew-dispatch-service';
import { readPhotoResponse } from '../app/crew-jobs/photo-response';
import { chicagoDateKey } from '../lib/chicago-date';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-crew-assignment-'));
  process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR = path.join(root, 'operations');
  process.env.OPS_CREW_DISPATCH_DIR = path.join(root, 'crew');
  process.env.OPS_CREW_TRUCK_SWITCH_DIR = path.join(root, 'switches');
  process.env.JOB_ROUTE_ASSIGNMENTS_FILE = path.join(root, 'assignments.json');
  const date = chicagoDateKey(), actor = 'test-manager', truck = 'Truck 6';
  const jobs = ['901', '902', '903', '904', '905'].map(appointmentId => ({appointmentId, recordId:`${date}:appointment:${appointmentId}`, version:'a'.repeat(64), truck, status:'Confirmed', jkNumber:`SAMPLE-${appointmentId}`, customerName:`Synthetic ${appointmentId}`, phone:'(225) 555-0100', address:'Synthetic address', appointmentTime:'4 PM–5 PM', junkItems:[], appointmentNotes:[], driver:'', navigator:''}));
  let writes = 0;
  const sources:CrewDispatchSources={
    schedule:()=>({observedAt:new Date().toISOString(),appointments:jobs}),
    receipts:async()=>[],
    assignment:async appointmentId=>({appointmentId,truck:jobs.find(job=>job.appointmentId===appointmentId)?.truck || '',date,status:'Confirmed'}),
    closeout:async()=>{throw new Error('Closeout is not used in this test.');},
  };
  const operation = (index: number, assignCrew?: boolean) => parseScheduleOperation({requestId:randomUUID(), date, recordId:jobs[index].recordId, expectedVersion:jobs[index].version, action:'move', values:{truck, ...(assignCrew === undefined ? {} : {assignCrew})}});
  const save = async () => { writes++; return {status:200, body:{ok:true}}; };
  try {
    for (const [index,flag,expected] of [[0,undefined,'assigned'],[1,true,'queued'],[2,false,'queued']] as const) {
      const move = operation(index, flag);
      const receipt = await executeScheduleOperation(move, actor, () => jobs[index] as unknown as DesktopAppointment, save);
      assert.equal(receipt.status, 'verified');
      assert.equal(receipt.crewAssignment?.state, 'pending', 'Every supported truck move records a Waypoint assignment intent');
      const finished=await finishScheduleCrewAssignment(move.requestId, actor, sources);
      assert.equal(finished?.crewAssignment?.state, expected, 'Current and older tabs use the same Schedule-to-Waypoint behavior');
      const before = writes;
      await executeScheduleOperation(move, actor, () => jobs[index] as unknown as DesktopAppointment, save);
      assert.equal(writes, before, 'Retry must not repeat the source write');
    }
    const existing=readCrewDispatch(truck);
    assert.equal(existing.current?.appointmentId,'901');
    assert.equal(existing.queued?.appointmentId,'902');
    // Use a separate truck to prove a full queue does not roll back the verified JunkWare move.
    const fullTruck='Truck 5';
    releaseCrewJob({truck:fullTruck, requestId:randomUUID(), expectedVersion:0, appointmentId:'901', date}, actor);
    releaseCrewJob({truck:fullTruck, requestId:randomUUID(), expectedVersion:1, appointmentId:'902', date}, actor);
    const fullQueue = readCrewDispatch(fullTruck);
    jobs[2].truck=fullTruck;
    const third=parseScheduleOperation({requestId:randomUUID(),date,recordId:jobs[2].recordId,expectedVersion:jobs[2].version,action:'move',values:{truck:fullTruck}});
    assert.equal((await executeScheduleOperation(third, actor, () => jobs[2] as unknown as DesktopAppointment, save)).status, 'verified', 'Full Waypoint queue cannot block truck scheduling');
    assert.equal((await finishScheduleCrewAssignment(third.requestId,actor,sources))?.crewAssignment?.state,'queued');
    assert.deepEqual(readCrewDispatch(fullTruck), fullQueue, 'Existing current and queued releases survive while the receipt reports attention');

    // Seed old receipts to exercise restart recovery across the behavior change.
    const legacy = operation(3, true);
    const saved = await executeScheduleOperation(legacy, actor, () => jobs[3] as unknown as DesktopAppointment, save);
    const old = {...saved, crewAssignment:{truck:'Truck 4', expectedVersion:0, state:'pending', message:'Old implicit release'}};
    fs.writeFileSync(path.join(process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR, `${legacy.requestId}.json`), JSON.stringify(old));
    const recovered = await Promise.all([finishScheduleCrewAssignment(legacy.requestId, actor, sources), finishScheduleCrewAssignment(legacy.requestId, actor, sources)]);
    assert.ok(recovered.every(receipt => receipt?.crewAssignment?.state === 'attention'));
    assert.equal(readCrewDispatch('Truck 4').version, 0, 'A source mismatch cannot create a release');

    const crash = operation(4, true);
    const crashReceipt = await executeScheduleOperation(crash, actor, () => jobs[4] as unknown as DesktopAppointment, save);
    fs.writeFileSync(path.join(process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR, `${crash.requestId}.json`), JSON.stringify({...crashReceipt, crewAssignment:{...old.crewAssignment, truck:'Truck 3'}}));
    releaseCrewJob({truck:'Truck 3', requestId:crash.requestId, expectedVersion:0, appointmentId:'905', date}, actor);
    assert.equal((await finishScheduleCrewAssignment(crash.requestId, actor, sources))?.crewAssignment?.state, 'assigned', 'An existing durable release is recovered honestly');
    assert.equal(readCrewDispatch('Truck 3').version, 1, 'Recovery cannot replay a release');

    await assert.rejects(readPhotoResponse(new Response('<html>Gateway timeout</html>', {status:504})), /Photo service/);
    await assert.rejects(readPhotoResponse(Response.json({error:'Reconnect this phone.'}, {status:401})), /Reconnect/);
    assert.deepEqual(await readPhotoResponse(Response.json({photos:[]})), {photos:[]});
    assert.deepEqual(await readPhotoResponse(Response.json({error:'Not found'}, {status:404})), {error:'Not found'});
    console.log('PASS Schedule-to-Waypoint assignment: current/legacy clients, full queue attention, exact retries, source mismatch and crash recovery. No live writes.');
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
}
void main();
