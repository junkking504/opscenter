import assert from 'node:assert/strict';
import { submitScheduleOperation } from '../desktop-ui/lib/schedule-operation-transport';
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
  console.log('Closeout recovery passed: reopen after save and transport failure, partial-save protection, source unavailability, one POST through proxy failure/pending/404, bounded receipt polling. Synthetic only.');
}
void main();
