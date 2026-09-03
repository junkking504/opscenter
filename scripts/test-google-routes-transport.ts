import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { requestGoogleRouteMatrix } from '../lib/google-routes-transport';

async function response(status: number, text: string, failure?: 'request' | 'response' | 'aborted') {
  let drained = false;
  let destroyed = false;
  const result = await requestGoogleRouteMatrix('test-only-key', '{"test":true}', (options, receive) => {
    assert.equal(options.hostname, 'routes.googleapis.com');
    assert.equal(options.family, 4, 'Preserve the approved egress IP without weakening key restrictions');
    assert.equal(options.method, 'POST');
    assert.equal(options.path, '/distanceMatrix/v2:computeRouteMatrix');
    assert.ok(options.signal);
    assert.equal((options.headers as Record<string, unknown>)['X-Goog-Api-Key'], 'test-only-key');
    assert.equal((options.headers as Record<string, unknown>)['Content-Length'], 13);
    const req = new EventEmitter() as ClientRequest;
    req.end = ((body: string) => {
      assert.equal(body, '{"test":true}');
      queueMicrotask(() => {
        if (failure === 'request') { req.emit('error', new Error('test')); return; }
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = status;
        res.resume = (() => { drained = true; return res; }) as typeof res.resume;
        res.destroy = (() => { destroyed = true; return res; }) as typeof res.destroy;
        receive(res);
        if (failure) { res.emit(failure === 'response' ? 'error' : 'aborted', new Error('test')); return; }
        res.emit('data', Buffer.from(text));
        res.emit('end');
      });
      return req;
    }) as typeof req.end;
    return req;
  });
  return { result, drained, destroyed };
}

async function main() {
  assert.deepEqual((await response(200, '[{"duration":"600s"}]')).result, [{ duration: '600s' }]);
  const denied = await response(403, '[{"error":{"code":403}}]');
  assert.equal(denied.result, null);
  assert.equal(denied.drained, true);
  assert.equal((await response(200, '{}')).result, null);
  assert.equal((await response(200, 'invalid')).result, null);
  for (const failure of ['request', 'response', 'aborted'] as const) assert.equal((await response(200, '[]', failure)).result, null);
  const large = await response(200, 'x'.repeat(1_048_577));
  assert.equal(large.result, null);
  assert.equal(large.destroyed, true);
  console.log('Google Routes transport passed: approved IPv4, scoped HTTPS, header-only key, bounded response, failures unavailable.');
}
void main();
