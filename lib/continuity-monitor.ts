import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ContinuitySnapshot } from '../desktop-ui/lib/continuity-contract';

export function continuitySnapshot(now = Date.now(), file = process.env.OPSCENTER_CONTINUITY_MONITOR_FILE || path.join(os.homedir(), 'Library/Application Support/OpsCenter/continuity-control/monitor.json')): ContinuitySnapshot {
  const empty: ContinuitySnapshot = { available: false, fresh: false, checkedAt: null, receivedAt: null, status: 'unknown', checks: [], incidents: [] };
  try {
    if (fs.statSync(file).size > 262144) return empty;
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bridge = Object.hasOwn(document, 'bridgeStatus');
    const value = bridge ? document.remote : document;
    const text = (input: unknown) => typeof input === 'string' && input.length <= 1000;
    if (value?.version !== 1 || !Array.isArray(value.checks) || value.checks.length !== 10 || !Array.isArray(value.incidents) || value.incidents.length > 20
      || value.checks.some((row: Record<string, unknown>) => !row || !text(row.key) || !text(row.title) || !text(row.evidence) || !text(row.nextStep) || !['ok', 'warn', 'unknown'].includes(String(row.status)))
      || new Set(value.checks.map((row: { key: string }) => row.key)).size !== 10
      || value.incidents.some((row: Record<string, unknown>) => !row || !text(row.key) || !['confirming', 'open', 'resolved'].includes(String(row.status)) || !text(row.firstSeenAt) || !text(row.lastSeenAt) || !Number.isInteger(row.occurrences) || Number(row.occurrences) < 1 || (row.resolvedAt !== null && !text(row.resolvedAt)))) return empty;
    const current = (at: unknown) => typeof at === 'string' && Number.isFinite(Date.parse(at)) && now >= Date.parse(at) && now - Date.parse(at) <= 180000;
    const fresh = current(value.checkedAt) && (!bridge || document.bridgeStatus === 'success' && current(document.receivedAt));
    return { available: true, fresh, checkedAt: value.checkedAt, receivedAt: bridge ? document.receivedAt : value.checkedAt,
      status: !fresh ? 'unknown' : (value.checks.some((row: { status: string }) => row.status !== 'ok') || value.incidents.some((row: { status: string }) => row.status !== 'resolved')) ? 'attention' : 'ready', checks: value.checks, incidents: value.incidents };
  } catch { return empty; }
}
