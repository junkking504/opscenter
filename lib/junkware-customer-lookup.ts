import { spawn } from 'node:child_process';
import path from 'node:path';
import { customerSearchFields, normalizeCustomerSelection, type CustomerLookupResult } from './junkware-customer-contract';
let active = false;
export async function lookupJunkwareCustomer(input: { query: string; key?: string }): Promise<CustomerLookupResult> {
  customerSearchFields(input.query);
  if (input.key) normalizeCustomerSelection(input);
  if (active) throw new Error('A JunkWare customer search is running. Please try again shortly.');
  active = true;
  try {
    return await new Promise<CustomerLookupResult>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', path.join(process.cwd(), 'scripts/create-junkware-appointment.ts'), '--customer-lookup'], { cwd: process.cwd(), env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('JunkWare customer search timed out. Please try again.')); }, 90000);
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 256000) { child.kill('SIGKILL'); } });
      // Upstream errors may contain customer data; do not log or return them.
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('error', () => { clearTimeout(timer); reject(new Error('JunkWare customer search is unavailable. Please try again.')); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error('JunkWare customer search is unavailable or the selected record changed. Search again.'));
        try {
          const result = JSON.parse(output) as CustomerLookupResult;
          if (!Array.isArray(result.matches) || !result.checkedAt) throw new Error();
          resolve(result);
        } catch { reject(new Error('JunkWare returned an unreadable customer search. Please try again.')); }
      });
      child.stdin.end(JSON.stringify(input));
    });
  } finally { active = false; }
}
