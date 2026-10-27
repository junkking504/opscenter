import assert from 'node:assert/strict';
import { readSearchJson, SearchRequestError, searchFailureMessage } from '../desktop-ui/lib/search-response';

async function main() {
  const fallback = 'Search is temporarily unavailable.';
  for (const status of [200, 502, 504]) {
    await assert.rejects(readSearchJson(new Response('<!DOCTYPE html><title>Unavailable</title>', {
      status, headers: { 'Content-Type': 'text/html' },
    }), fallback), { message: fallback });
  }
  for (const body of ['{broken', 'null', '[]', '"unexpected"']) {
    await assert.rejects(readSearchJson(new Response(body, { headers: { 'Content-Type': 'application/json' } }), fallback), { message: fallback });
  }
  const expired = new Response('<html>Sign in</html>', { status: 401 });
  await assert.rejects(readSearchJson(expired, fallback), /session has expired/);
  const login = new Response('<html>Sign in</html>');
  Object.defineProperties(login, { redirected: { value: true }, url: { value: 'https://example.test/login?next=search' } });
  await assert.rejects(readSearchJson(login, fallback), /session has expired/);
  const redirect = Response.json({ results: [] });
  Object.defineProperties(redirect, { redirected: { value: true }, url: { value: 'https://example.test/maintenance' } });
  await assert.rejects(readSearchJson(redirect, fallback), { message: fallback });
  const result = { results: [{ id: 'synthetic', title: 'Example record' }], appointmentTotal: 1 };
  assert.deepEqual(await readSearchJson(Response.json(result), fallback), result);
  // Preserve HTTP error payloads and usage metadata for the caller to handle.
  const unavailable = { error: 'A submitted question remains counted.', remaining: 21, limit: 50 };
  assert.deepEqual(await readSearchJson(Response.json(unavailable, { status: 502 }), fallback), unavailable);
  assert.equal(searchFailureMessage(new SearchRequestError('Sign in again.'), fallback), 'Sign in again.');
  assert.equal(searchFailureMessage(new SyntaxError('Unexpected token <'), fallback), fallback);
  assert.equal(searchFailureMessage(new TypeError('Failed to fetch'), fallback), fallback);
  assert.match(searchFailureMessage(new DOMException('signal timed out', 'TimeoutError'), fallback), /request took too long/);
  console.log('Search response tests passed: HTML, malformed JSON, sign-in, redirects, network, timeout, valid results and usage metadata.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
