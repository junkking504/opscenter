import { spawn } from 'node:child_process';
import path from 'node:path';
/** Registered sensitive actions; all entry points use the same durable source adapter. */
export const ACCOUNTING_ACTIONS = {
  receive: { id: 'finance.verify-payment-received', permission: 'sensitive.write', risk: 3 },
  verify: { id: 'finance.verify-payment-and-sync', permission: 'sensitive.write', risk: 3 },
  update: { id: 'finance.update-quickbooks', permission: 'sensitive.write', risk: 3 },
  exclude: { id: 'finance.exclude-from-quickbooks', permission: 'sensitive.write', risk: 3 },
} as const;
export function runJunkwareAccounting(input: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/python3', [path.join(process.cwd(), 'scripts/junkware-accounting.py')], { cwd: process.cwd(), env: process.env, stdio: ['pipe','pipe','pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('The source response timed out. Check saved result before another accounting action.')); }, 240_000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 8_000_000) child.kill(); });
    child.stderr.resume();
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', () => { clearTimeout(timer); try { const result = JSON.parse(output); if (!result.ok) reject(new Error(result.error)); else resolve(result.data); } catch { reject(new Error('The accounting response is unavailable. Check saved result before submitting again.')); } });
    child.stdin.end(JSON.stringify(input));
  });
}
