import assert from 'node:assert/strict';
import { assignmentSessionState } from './junkware-assignment-session';
import { submitScheduleOperation } from '../desktop-ui/lib/schedule-operation-transport';
import {
  applyBackgroundScheduleMove,
  backgroundScheduleMove,
  sourceMatchesBackgroundScheduleMove,
} from '../desktop-ui/lib/schedule-move-background';
import type { MoveProposal, ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';

async function main() {
  const original = { cookies: [{name:'ASP.NET_SessionId',value:'collector'}, {name:'.ASPXAUTH',value:'synthetic-auth'}], origins: [] };
  const isolated = assignmentSessionState(original);
  assert.deepEqual(isolated.cookies, [original.cookies[1]], 'Keep authentication while removing the shared server session');
  assert.equal(original.cookies.length, 2, 'Do not mutate collector state');

  const job = {
    recordId:'2026-09-23:appointment:1234', appointmentId:'1234', version:'a'.repeat(64),
    callAhead:'not_called', jkNumber:'JK1234', appointmentUrl:'', appointmentTime:'9:00 AM–10:00 AM',
    appointmentStartMinutes:540, appointmentEndMinutes:600, hasScheduledTime:true,
    customerName:'Synthetic appointment', customerEmail:'', phone:'', address:'', territory:'New Orleans',
    appointmentType:'Job', status:'Confirmed', truck:'Truck 1', driver:'', navigator:'', paymentType:'',
    paymentAmount:0, tipAmount:0, junkItems:[], appointmentNotes:[], cancellationReason:'', location:null,
  } satisfies ScheduleAppointment;
  const proposal = {job,truck:'Truck 2',start:600,conflicts:[]} satisfies MoveProposal;
  const optimistic = backgroundScheduleMove(proposal,'00000000-0000-4000-8000-000000000001');
  const displayed = applyBackgroundScheduleMove(job,optimistic);
  assert.equal(displayed.truck,'Truck 2','The board moves immediately to the destination truck');
  assert.equal(displayed.appointmentTime,'10:00 AM–11:00 AM','The board moves immediately to the destination window');
  assert.equal(displayed.junkwareSyncStatus,'pending','The moved appointment is protected while verification runs');
  assert.equal(sourceMatchesBackgroundScheduleMove(displayed,optimistic),false,'A pending optimistic row is not source confirmation');
  assert.equal(sourceMatchesBackgroundScheduleMove({...displayed,junkwareSyncStatus:'verified'},optimistic),true,'Only the exact verified source row retires the overlay');

  let posts=0;
  let release: (()=>void)|undefined;
  const source = new Promise<void>(resolve => { release=resolve; });
  const submission = submitScheduleOperation({
    requestId:optimistic.requestId,date:'2026-09-23',recordId:job.recordId,expectedVersion:job.version,
    action:'move',values:{truck:'Truck 2',appointmentStartMinutes:600,durationHours:1},
  },{fetch:async (_input,init)=>{
    assert.equal(init?.method,'POST');
    posts++;
    await source;
    return Response.json({receipt:{requestId:optimistic.requestId,status:'verified',message:'Synthetic source verified.'}});
  }});
  assert.equal(posts,1,'The background move submits exactly once');
  assert.equal(applyBackgroundScheduleMove(job,optimistic).truck,'Truck 2','The board does not wait for the held source response');
  release?.();
  assert.equal((await submission).status,'verified');
  assert.equal(posts,1,'Verification never replays the move');
  console.log('Move background regressions passed: isolated source session, immediate board move, pending protection, exact source retirement, and one POST only.');
}

void main();
