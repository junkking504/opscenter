import fs from 'node:fs';
import path from 'node:path';
import { detectMaintenance, maintenanceDirectory, readClientEvents, readMaintenanceState, reconcileMaintenance, saveMaintenanceState } from '../lib/maintenance-monitor';
import { diagnoseMaintenance } from '../lib/maintenance-diagnosis';
import { investigateAddresses } from '../lib/address-research';
import { addressResearchCandidates, publishAddressEvidence } from '../lib/address-research-store';

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
    if (!reconcileMaintenance(state, detectMaintenance({ health, readiness, login: typeof login === 'boolean' ? login : null, clientEvents: readClientEvents(directory) }, now), now)) return;
    const persist = () => {
      saveMaintenanceState(state, directory);
      // Once initialized, deleting just the research section cannot reset any
      // lifetime per-address allowance. The shared ledger remains authoritative.
      if (state.addressResearch) {
        const marker = path.join(directory, 'address-research-initialized');
        if (!fs.existsSync(marker)) { const fd = fs.openSync(marker, 'wx', 0o600); try { fs.writeFileSync(fd, '1\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
      }
    };
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
    else {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
      let candidates;
      try { candidates = addressResearchCandidates(today); } catch {
        if (state.addressResearch) state.addressResearch.status = 'Schedule evidence unavailable; retaining the address queue';
        persist();
      }
      const worked = candidates ? await investigateAddresses(state, apiKey, persist, { candidates, publish: publishAddressEvidence, now }) : false;
      // One finite worker owns the shared lock/ledger. A research tick does not
      // also launch two diagnosis requests and exceed the observer deadline.
      if (!worked) await diagnoseMaintenance(state, apiKey, persist, now);
    }
    console.log(JSON.stringify({ mode: 'observe', checkedAt: state.checkedAt, open: state.incidents.filter(i => i.status === 'open').length, aiStatus: state.aiStatus }));
}
main().catch(() => { console.error('Maintenance observation failed; no repair was attempted. Check worker storage and configuration.'); process.exitCode = 1; });
