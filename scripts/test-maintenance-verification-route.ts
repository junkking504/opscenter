import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { recordClientRecovery, readClientRecovery } from '../lib/maintenance-client-recovery';
import { opsRoleCan } from '../lib/ops-roles';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-verification-route-'));
const failureAt = Date.now() - 60_000;
let signedIn = true, role: 'admin' | 'manager' = 'admin', writes = 0;
const dependencies: Record<string, unknown> = {
  'next/headers': { cookies: async () => ({ get: () => ({ value: 'synthetic' }) }) },
  '@/lib/auth': { AUTH_SESSION_COOKIE: 'test', verifyAuthSessionCookie: async () => signedIn ? { email: 'fixture-admin' } : null, opsAuthRole: () => role },
  '@/lib/ops-roles': { opsRoleCan },
  '@/lib/desktop-request-origin': { isDesktopWriteOriginAllowed: (request: Request) => request.headers.get('origin') === new URL(request.url).origin },
  '@/lib/maintenance-monitor': { maintenanceDirectory: () => directory },
  '@/lib/maintenance-client-recovery': { recordClientRecovery: (...args: Parameters<typeof recordClientRecovery>) => { writes++; return recordClientRecovery(...args); } },
};
const compiled = ts.transpileModule(fs.readFileSync(new URL('../app/api/desktop/maintenance/verification/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const handlers: { POST?: (request: Request) => Promise<Response> } = {};
new Function('require', 'exports', compiled)((name: string) => { assert(name in dependencies); return dependencies[name]; }, handlers);

async function main() {
  const payload = { category: 'schedule', failureAt, evidence: 'Synthetic successful Schedule interaction check.' };
  const send = (body: unknown = payload, origin = 'https://fixture.invalid') => handlers.POST!(new Request('https://fixture.invalid/api/desktop/maintenance/verification', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  try {
    fs.writeFileSync(path.join(directory, 'schedule.json'), JSON.stringify({ at: failureAt, count: 1 }));
    signedIn = false; assert.equal((await send()).status, 401);
    signedIn = true; role = 'manager'; assert.equal((await send()).status, 403);
    role = 'admin'; assert.equal((await send(payload, 'https://untrusted.invalid')).status, 403);
    assert.equal((await send('{bad')).status, 400);
    assert.equal((await send({ ...payload, evidence: 123 })).status, 400);
    assert.equal((await send({ ...payload, evidence: 'x'.repeat(2200) })).status, 413);
    assert.equal(writes, 0, 'Rejected authentication, origin and body cannot write proof');
    assert.equal((await send({ ...payload, failureAt: failureAt - 1 })).status, 409);
    assert.equal(readClientRecovery('schedule', directory), undefined);
    const accepted = await send(); assert.equal(accepted.status, 200);
    assert.match(accepted.headers.get('cache-control') || '', /no-store/);
    assert.equal(readClientRecovery('schedule', directory)?.actor, 'fixture-admin');
    assert.equal(readClientRecovery('schedule', directory)?.failureAt, failureAt);
    assert.equal(fs.readdirSync(directory).filter(file => file.endsWith('.tmp')).length, 0);
    console.log('Recovery HTTP handler passed: authentication, admin role, origin, malformed/oversized body, stale generation and durable receipt.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
