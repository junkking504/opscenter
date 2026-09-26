import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { runCrewWrangler } from '../lib/crew-portal-sync';

const originalSpawn = childProcess.spawnSync;
const originalEnv = process.env;
const token = 'fixture-dedicated-token';
let keychainStatus = 0;
let keychainOutput = `${token}\n`;
let keychainCalls = 0;
let wranglerCalls = 0;
let childEnv: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
try {
  process.env = { NODE_ENV: 'test', PATH: originalEnv.PATH, CLOUDFLARE_API_TOKEN: 'fixture-shared-token',
    CLOUDFLARE_API_KEY: 'fixture-global-key', CF_API_KEY: 'fixture-legacy-key',
    CLOUDFLARE_ACCOUNT_ID: 'wrong-account', CF_ACCOUNT_ID: 'wrong-legacy-account' };
  const before = { ...process.env };
  childProcess.spawnSync = ((command: string, args: string[], options: {env?: NodeJS.ProcessEnv}) => {
    if (command === '/usr/bin/security') {
      keychainCalls++;
      assert.deepEqual(args, ['find-generic-password', '-a', 'opscenter', '-s',
        'com.opscenter.crew-portal-cloudflare-api-token', '-w']);
      return { status: keychainStatus, stdout: keychainOutput, stderr: 'private diagnostic' };
    }
    wranglerCalls++;
    childEnv = options.env || { NODE_ENV: 'test' };
    return {status: 0, stdout: '{}', stderr: ''};
  }) as typeof childProcess.spawnSync;
  syncBuiltinESMExports();

  // Never contact Cloudflare or the real Keychain in this regression.
  process.env.OPSCENTER_CREW_PORTAL_CLOUDFLARE_API_TOKEN = token;
  runCrewWrangler(['kv', 'key', 'get', 'fixture']);
  assert.equal(childEnv.CLOUDFLARE_API_TOKEN, token, 'Crew sync must use its dedicated credential, not shared OAuth/API credentials');
  assert.equal(keychainCalls, 0);
  assert.equal(childEnv.CLOUDFLARE_ACCOUNT_ID, 'ea8cff934d688ef194de52a1ae819717');
  for (const name of ['CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY', 'CLOUDFLARE_EMAIL', 'CF_EMAIL', 'CF_ACCOUNT_ID', 'OPSCENTER_CREW_PORTAL_CLOUDFLARE_API_TOKEN']) {
    assert.equal(childEnv[name], undefined, `Do not forward ${name}`);
  }
  assert.equal(childEnv.WRANGLER_SEND_METRICS, 'false');
  delete process.env.OPSCENTER_CREW_PORTAL_CLOUDFLARE_API_TOKEN;
  assert.deepEqual(process.env, before, 'Do not mutate shared process credentials');

  if (process.platform === 'darwin') {
    runCrewWrangler(['kv', 'key', 'get', 'fixture']);
    assert.equal(keychainCalls, 1);
    assert.equal(childEnv.CLOUDFLARE_API_TOKEN, token);
    for (const [status, output] of [[44, ''], [1, token], [0, ''], [0, 'bad\ntoken']] as const) {
      keychainStatus = status; keychainOutput = output;
      const calls = wranglerCalls;
      assert.throws(() => runCrewWrangler([]), /dedicated credential unavailable/);
      assert.equal(wranglerCalls, calls, 'Fail closed before launching Wrangler');
    }
  } else {
    assert.throws(() => runCrewWrangler([]), /dedicated credential unavailable/);
    assert.equal(keychainCalls, 0);
  }
  process.env.OPSCENTER_CREW_PORTAL_CLOUDFLARE_API_TOKEN = 'bad\ntoken';
  assert.throws(() => runCrewWrangler([]), /dedicated credential unavailable/);
  console.log('Crew sync dedicated credential regression checks passed.');
} finally {
  childProcess.spawnSync = originalSpawn;
  syncBuiltinESMExports();
  process.env = originalEnv;
}
