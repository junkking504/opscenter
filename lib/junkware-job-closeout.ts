import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export class JunkwareCloseoutError extends Error {
  constructor(message: string, readonly stage: 'preflight' | 'uncertain', readonly code = 'closeout_unavailable') { super(message); this.name = 'JunkwareCloseoutError'; }
}
/** Only a structured child-process statement proves no write started. Timeouts and unstructured exits stay uncertain. */
export function classifyCloseoutFailure(error: unknown): JunkwareCloseoutError {
  const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr || '') : '';
  try {
    const payload = JSON.parse(stderr.trim().split('\n').at(-1) || '') as Record<string, unknown>;
    if (payload.stage === 'preflight' || payload.stage === 'uncertain') return new JunkwareCloseoutError(String(payload.error || 'JunkWare could not verify the closeout.').slice(0, 400), payload.stage, String(payload.code || 'closeout_unavailable'));
  } catch { /* Unclassified failures may have followed a source write. */ }
  return new JunkwareCloseoutError('JunkWare could not confirm the closeout result. Inspect the source before retrying.', 'uncertain');
}
export async function junkwareJobCloseout(appointmentId: string, payload?: Record<string, unknown>) {
  if (!/^\d{1,12}$/.test(appointmentId)) throw new JunkwareCloseoutError('The JunkWare appointment ID is unavailable.', 'preflight');
  const args = ['--import', 'tsx', path.join(process.cwd(), 'scripts', 'sync-junkware-job-closeout.ts'), '--appointment', appointmentId, '--mode', payload ? 'write' : 'read'];
  if (payload) args.push('--payload-base64', Buffer.from(JSON.stringify(payload)).toString('base64url'));
  try {
    const { stdout } = await execFileAsync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8', timeout: 180_000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env } });
    const result = JSON.parse(String(stdout || '').trim()); if (!result?.ok) throw new Error('JunkWare did not verify the closeout.'); return result;
  } catch (error) { throw classifyCloseoutFailure(error); }
}
