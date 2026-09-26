import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function syncFailureCategory(output: string, code?: string) {
  if (/10000|authentication error|unauthorized|forbidden/i.test(output)) return 'authentication';
  if (/429|rate.limit/i.test(output)) return 'rate_limit';
  if (/fetch failed|ECONN|ETIMEDOUT|network|socket|timeout/i.test(output + ' ' + code)) return 'network';
  if (code === 'ENOBUFS') return 'output_limit';
  return 'command_failed';
}
export function nextSyncStatus(previous: Record<string, unknown>, update: Record<string, unknown>) {
  return { version: 2, lastSuccessAt: previous.lastSuccessAt || null, ...update };
}
export function writeCrewSyncStatus(file: string, update: Record<string, unknown>) {
  let previous = {}; try { previous = JSON.parse(fs.readFileSync(file,'utf8')); } catch { /* First publication. */ }
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp,JSON.stringify(nextSyncStatus(previous,update))+'\n',{mode:0o600}); fs.renameSync(temp,file);
}
type Run = (args: string[]) => { status: number | null; stdout: string; stderr: string; error?: Error & {code?: string}; signal?: string | null };
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve,ms));
/** Retry identical publication payloads only. Never log payloads, credentials, or raw CLI output. */
export async function publishCrewValue(key: string, payloadPath: string, expected: unknown, run: Run, sleep = wait) {
  for (let attempt=1;attempt<=3;attempt++) {
    const result=run(['kv','key','put',key,'--path',payloadPath,'--binding','CREW_METRICS','--remote']);
    if (result.status === 0 && !result.error && !/\[ERROR\]/.test(result.stderr)) break;
    const category=syncFailureCategory(result.stdout+'\n'+result.stderr,result.error?.code);
    if (attempt===3 || !['network','rate_limit'].includes(category)) throw new Error(`Crew Portal upload ${category}; exit=${result.status ?? 'none'}; signal=${result.signal || 'none'}; code=${result.error?.code || 'none'}; attempts=${attempt}.`);
    await sleep(attempt*2000);
  }
  // KV propagation may lag the successful write. Retry reads without replaying the write.
  for (let attempt=0;attempt<5;attempt++) {
    if (attempt) await sleep([0,2000,5000,15000,40000][attempt]);
    const result=run(['kv','key','get',key,'--binding','CREW_METRICS','--remote']);
    if(result.status===0&&!result.error) { try { if(JSON.stringify(JSON.parse(result.stdout))===JSON.stringify(expected)) return; } catch { /* Verification remains unconfirmed. */ } }
    const category=syncFailureCategory(result.stderr,result.error?.code);
    if(category==='authentication') throw new Error('Crew Portal read-back authentication failed. Publication may have succeeded.');
  }
  throw new Error('Crew Portal publication read-back unconfirmed after bounded retries.');
}
export function runCrewWrangler(args: string[]) {
  // Resolve only this publisher's credential. Never refresh or fall back to the
  // shared interactive OAuth login used by unrelated Wrangler/deployment jobs.
  let token = process.env.OPSCENTER_CREW_PORTAL_CLOUDFLARE_API_TOKEN;
  if (token === undefined && process.platform === 'darwin') {
    const stored = spawnSync('/usr/bin/security', [
      'find-generic-password', '-a', 'opscenter', '-s',
      'com.opscenter.crew-portal-cloudflare-api-token', '-w',
    ], { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 });
    if (stored.status === 0 && !stored.error) token = stored.stdout.trim();
  }
  if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) {
    // Never include Keychain output, provider credentials or exception contents.
    throw new Error('Crew Portal dedicated credential unavailable; authentication required.');
  }
  const env = { ...process.env };
  for (const name of ['CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY',
    'CLOUDFLARE_EMAIL', 'CF_EMAIL', 'CF_ACCOUNT_ID',
    'OPSCENTER_CREW_PORTAL_CLOUDFLARE_API_TOKEN']) delete env[name];
  env.CLOUDFLARE_API_TOKEN = token;
  // Account owning the existing CREW_METRICS namespace in wrangler.toml.
  env.CLOUDFLARE_ACCOUNT_ID = 'ea8cff934d688ef194de52a1ae819717';
  env.WRANGLER_SEND_METRICS = 'false';
  return spawnSync(path.join(process.cwd(),'node_modules','.bin','wrangler'),args,{cwd:process.cwd(),encoding:'utf8',timeout:45000,maxBuffer:64*1024*1024,env});
}
