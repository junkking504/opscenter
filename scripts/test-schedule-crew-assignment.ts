import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DesktopAppointment } from '../lib/desktop-schedule';
import { executeScheduleOperation, finishScheduleCrewAssignment, parseScheduleOperation } from '../lib/desktop-schedule-operations';
import { readCrewDispatch, releaseCrewJob } from '../lib/crew-dispatch-store';
import { crewCurrentPayload, type CrewDispatchSources } from '../lib/crew-dispatch-service';
import { readPhotoResponse } from '../app/crew-jobs/photo-response';

async function main() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'schedule-crew-assignment-'));
  process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR=path.join(root,'operations');
  process.env.OPS_CREW_DISPATCH_DIR=path.join(root,'crew');
  process.env.JOB_ROUTE_ASSIGNMENTS_FILE=path.join(root,'assignments.json');
  const date='2026-09-18', actor='test-manager', truck='Truck 6';
  const jobs=['901','902','903','904','905'].map(appointmentId=>({appointmentId,recordId:`${date}:appointment:${appointmentId}`,version:'a'.repeat(64),truck,status:'Confirmed',jkNumber:`SAMPLE-${appointmentId}`,customerName:`Synthetic ${appointmentId}`,address:'Synthetic address',appointmentTime:'4 PM–5 PM',junkItems:[],appointmentNotes:[],driver:'',navigator:''}));
  jobs[1].appointmentTime='8 AM–9 AM'; // A next job need not follow booked-time order.
  let writes=0,sourceStatus='Confirmed',sourceTruck=truck;
  const sources:CrewDispatchSources={schedule:()=>({observedAt:new Date().toISOString(),appointments:jobs}),receipts:async()=>[],assignment:async appointmentId=>({appointmentId,date,truck:sourceTruck,status:sourceStatus}),closeout:async()=>({})};
  const operation=(index:number,assignCrew=true)=>parseScheduleOperation({requestId:randomUUID(),date,recordId:jobs[index].recordId,expectedVersion:jobs[index].version,action:'move',values:{truck,assignCrew}});
  const save=async()=>{writes++;return{status:200,body:{ok:true}};};
  try {
    const first=operation(0);
    const move=await executeScheduleOperation(first,actor,()=>jobs[0] as unknown as DesktopAppointment,save);
    assert.equal(move.crewAssignment?.state,'pending');assert.equal(readCrewDispatch(truck).current,null);
    const finished=await Promise.all([finishScheduleCrewAssignment(first.requestId,actor,sources),finishScheduleCrewAssignment(first.requestId,actor,sources)]);
    assert.ok(finished.every(value=>value?.crewAssignment?.state==='assigned'));
    assert.equal(readCrewDispatch(truck).version,1);assert.equal(writes,1);
    await executeScheduleOperation(first,actor,()=>jobs[0] as unknown as DesktopAppointment,save);
    assert.equal(writes,1,'Repeat POST cannot repeat source move');
    const same=operation(0);await executeScheduleOperation(same,actor,()=>jobs[0] as unknown as DesktopAppointment,save);
    await finishScheduleCrewAssignment(same.requestId,actor,sources);
    assert.equal(readCrewDispatch(truck).version,1,'Same-lane drop must not duplicate current assignment');
    const second=operation(1);await executeScheduleOperation(second,actor,()=>jobs[1] as unknown as DesktopAppointment,save);
    assert.equal((await finishScheduleCrewAssignment(second.requestId,actor,sources))?.crewAssignment?.state,'queued');
    const payload=await crewCurrentPayload({deviceId:randomUUID(),truck,label:'Synthetic',enrolledAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()},sources);
    assert.equal(payload.job?.appointmentId,'901');assert.equal(JSON.stringify(payload).includes('Synthetic 902'),false,'A non-chronological queue must remain hidden');
    const before=writes;
    await assert.rejects(executeScheduleOperation(operation(2),actor,()=>jobs[2] as unknown as DesktopAppointment,save),/queued/);
    assert.equal(writes,before,'Full phone queue must block before JunkWare write');
    // Isolate a different truck to test an uncertain move and a later dispatch race.
    jobs[2].truck='Truck 3';sourceTruck='Truck 3';
    const uncertain={...operation(2),values:{truck:'Truck 3',assignCrew:true}};
    await executeScheduleOperation(uncertain,actor,()=>jobs[2] as unknown as DesktopAppointment,async()=>({status:202,body:{ok:true}}));
    assert.equal((await finishScheduleCrewAssignment(uncertain.requestId,actor,sources))?.status,'uncertain');
    assert.equal(readCrewDispatch('Truck 3').current,null);
    jobs[3].truck='Truck 4';sourceTruck='Truck 4';
    const racing={...operation(3),values:{truck:'Truck 4',assignCrew:true}};
    await executeScheduleOperation(racing,actor,()=>jobs[3] as unknown as DesktopAppointment,save);
    releaseCrewJob({truck:'Truck 4',requestId:randomUUID(),expectedVersion:0,appointmentId:'999',date},actor);
    assert.equal((await finishScheduleCrewAssignment(racing.requestId,actor,sources))?.crewAssignment?.state,'attention');
    assert.equal(readCrewDispatch('Truck 4').current?.appointmentId,'999');
    assert.equal(readCrewDispatch('Truck 4').queued,null);
    // Crash recovery recognizes an already committed phone release without another write.
    jobs[4].truck='Truck 5';sourceTruck='Truck 5';
    const crash={...operation(4),values:{truck:'Truck 5',assignCrew:true}};
    await executeScheduleOperation(crash,actor,()=>jobs[4] as unknown as DesktopAppointment,save);
    releaseCrewJob({truck:'Truck 5',requestId:crash.requestId,expectedVersion:0,appointmentId:'905',date},actor);
    sourceStatus='Completed';
    assert.equal((await finishScheduleCrewAssignment(crash.requestId,actor,sources))?.crewAssignment?.state,'assigned');
    assert.equal(readCrewDispatch('Truck 5').version,1);
    await assert.rejects(readPhotoResponse(new Response('<html>Gateway timeout</html>',{status:504})),/Photo service/);
    await assert.rejects(readPhotoResponse(Response.json({error:'Reconnect this phone.'},{status:401})),/Reconnect/);
    assert.deepEqual(await readPhotoResponse(Response.json({photos:[]})),{photos:[]});
    assert.deepEqual(await readPhotoResponse(Response.json({error:'Not found'},{status:404})),{error:'Not found'});
    console.log('Schedule-to-phone assignment: verified release, same-lane idempotency, hidden queue, full-queue preflight, uncertain source, concurrent dispatch, crash recovery and photo response errors passed. No live writes.');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
void main();
