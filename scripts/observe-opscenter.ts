import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { detectMaintenance, readClientVerifications, maintenanceDirectory, readClientEvents, readMaintenanceState, reconcileMaintenance, saveMaintenanceState } from '../lib/maintenance-monitor';
import { diagnoseMaintenance } from '../lib/maintenance-diagnosis';

// One finite run per launchd interval. Re-resolving the release each run avoids
// keeping an obsolete immutable release alive after deployment.
async function main() {
  const directory = maintenanceDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.env.OPSCENTER_MAINTENANCE_LOCK_HELD !== '1') throw new Error('Use the locking launcher');
    const state = readMaintenanceState(directory);
    const probe = async (route: string, json = true) => {
      try {
        const response = await fetch(`http://127.0.0.1:3000${route}`, { headers: { Host: 'ops.junk-king.app' }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
        if (!json) return response.status === 200;
        const body = await response.text();
        if (body.length > 100_000) return null;
        return JSON.parse(body);
      } catch { return null; }
    };
    const [health, readiness, login] = await Promise.all([probe('/api/health'), probe('/api/readiness'), probe('/login', false)]);
    const now = Date.now();
    if (!state.workflowCheck || now - state.workflowCheck.at >= 300_000 || now < state.workflowCheck.at) {
      let results: Record<string, boolean | null> = { schedule: null, fleet: null };
      try {
        const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/check-maintenance-workflows.ts'], { cwd: process.cwd(), timeout: 15_000, maxBuffer: 16_384 });
        const value = JSON.parse(stdout);
        results = Object.fromEntries(['schedule','fleet'].map(key => [key, typeof value[key] === 'boolean' ? value[key] : null]));
      } catch { /* Timeout/unreadable data is reported, never treated as a pass. */ }
      state.workflowCheck = { at: now, results };
    }
    if (!reconcileMaintenance(state, detectMaintenance({ health, readiness, login: typeof login === 'boolean' ? login : null, clientEvents: readClientEvents(directory), verifications: readClientVerifications(directory), workflows: state.workflowCheck.results }, now), now)) return;
    const persist = () => saveMaintenanceState(state, directory);
    persist();
    let apiKey = process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      try {
        // Read only the authorized key assignment. Never source or evaluate this file.
        const config = fs.readFileSync(path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/.env.ai'), 'utf8');
        const raw = config.match(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*?)\s*$/m)?.[1] || '';
        apiKey = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, raw.lastIndexOf(raw[0])) : raw.split(/\s+#/)[0];
      } catch { /* detection continues without AI */ }
    }
    if (process.env.OPSCENTER_MAINTENANCE_AI_DISABLED === 'true') { state.aiStatus = 'AI disabled; observation continues'; persist(); }
    else await diagnoseMaintenance(state, apiKey, persist, now);
    console.log(JSON.stringify({ mode: 'observe', checkedAt: state.checkedAt, open: state.incidents.filter(i => i.status === 'open' || i.status === 'verification-needed').length, aiStatus: state.aiStatus }));
}
main().catch(() => { console.error('Maintenance observation failed; no repair was attempted. Check worker storage and configuration.'); process.exitCode = 1; });
