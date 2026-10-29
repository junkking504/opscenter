import assert from 'node:assert/strict';
import { submitScheduleOperation, waitForScheduleReceipt } from '../desktop-ui/lib/schedule-operation-transport';
import { CloseoutNotAppliedError, saveAndVerifyCloseout } from '../lib/closeout-save-verification';

async function main() {
  const before = { status: 'Confirmed', payments: [] as number[] };
  const intended = { status: 'Completed', payments: [100] };
  const verify = (value: typeof before) => assert.deepEqual(value, intended);
  for (const transportFails of [false, true]) {
    let submits = 0, reads = 0;
    const source = await saveAndVerifyCloseout(before, async () => {
      submits++;
      if (transportFails) throw new Error('Lost response after save');
    }, async () => { reads++; return intended; }, verify);
    assert.deepEqual(source, intended);
    assert.equal(submits, 1); assert.equal(reads, 1);
  }
  await assert.rejects(saveAndVerifyCloseout(before, async () => {}, async () => before, verify), CloseoutNotAppliedError);
  await assert.rejects(saveAndVerifyCloseout(before, async () => {}, async () => ({ ...before, payments: [100] }), verify), error => !(error instanceof CloseoutNotAppliedError));
  await assert.rejects(saveAndVerifyCloseout(before, async () => {}, async () => { throw new Error('Source unavailable'); }, verify), /Source unavailable/);

  const payload = { requestId: 'synthetic-request' };
  for (const status of ['pending','uncertain']) {
    let calls=0;
    const old={requestId:'earlier-request',status,message:'Earlier change needs checking'};
    const conflict=await submitScheduleOperation(payload,{fetch:(async()=>{calls++;return Response.json({receipt:old},{status:409});}) as typeof fetch});
    assert.deepEqual(conflict,old,'A blocked new request must expose the original recovery receipt');
    assert.equal(calls,1,'Do not poll the rejected new UUID');
  }
  for (const scenario of ['lost-response', 'pending-response', 'gateway-html', 'missing-receipt', 'rejected', 'uncertain', 'never-finishes']) {
    let posts = 0, reads = 0, time = 0;
    const result = await submitScheduleOperation(payload, {
      now: () => time,
      pause: async ms => { time += ms; },
      fetch: (async (_url, options) => {
        if (options?.method === 'POST') {
          posts++;
          if (scenario === 'lost-response' || scenario === 'never-finishes') throw new Error('Disconnected');
          if (scenario === 'gateway-html') return new Response('Gateway timeout', { status: 504 });
          if (scenario === 'rejected') return Response.json({ error: 'Review required' }, { status: 422 });
          return Response.json({ receipt: { requestId: payload.requestId, status: 'pending', message: 'Saving' } });
        }
        reads++;
        if (scenario === 'never-finishes') return new Response('Unavailable', { status: 503 });
        if (scenario === 'missing-receipt' && reads === 1) return Response.json({}, { status: 404 });
        return Response.json({ receipt: { requestId: payload.requestId, status: reads === 1 ? 'pending' : scenario === 'uncertain' ? 'uncertain' : 'verified', message: 'Result' } });
      }) as typeof fetch,
    });
    assert.equal(posts, 1, `${scenario}: must never repeat the POST`);
    assert.equal(result.status, scenario === 'rejected' ? 'failed' : ['uncertain', 'never-finishes'].includes(scenario) ? 'uncertain' : 'verified');
    if (scenario === 'rejected') assert.equal(reads, 0);
    assert.ok(time <= 600_000);
  }
  for (const outcome of ['verified','failed','uncertain','missing','wrong-request','denied','offline','malformed','http-error']) {
    let reads=0,time=0;
    const result=await waitForScheduleReceipt('saved-request',{
      endpoint:'/api/crew-jobs/closeout?assignmentId=sample',now:()=>time,pause:async ms=>{time+=ms;},
      fetch:(async(url,options)=>{
        assert.notEqual(options?.method,'POST','Waiting can never replay a closeout');
        assert.match(String(url),/assignmentId=sample&requestId=saved-request$/);
        assert.doesNotMatch(String(url),/reconcile/,'No missing-submission recovery action');
        reads++;
        if(outcome==='denied')return Response.json({}, {status:403});
        if(outcome==='offline')throw new Error('Offline');
        if(outcome==='missing')return Response.json({}, {status:404});
        if(outcome==='malformed')return Response.json({receipt:{requestId:'saved-request',message:'Incomplete response'}});
        if(outcome==='http-error')return Response.json({receipt:{requestId:'saved-request',status:'verified'}},{status:503});
        return Response.json({receipt:{requestId:outcome==='wrong-request'?'different-request':'saved-request',status:reads===1?'pending':outcome,message:'Synthetic result'}});
      }) as typeof fetch,
    });
    assert.equal(result.status,['verified','failed','uncertain'].includes(outcome)?outcome:'uncertain');
    assert.equal(result.requestId,'saved-request');assert.ok(time<=600_000);
    if(outcome==='denied')assert.equal(reads,1,'Stop reading when authorization is unavailable');
  }
  console.log('Closeout recovery passed: reopen after save and transport failure, partial-save protection, source unavailability, one POST through proxy failure/pending/404, bounded receipt polling. Synthetic only.');
}
void main();
