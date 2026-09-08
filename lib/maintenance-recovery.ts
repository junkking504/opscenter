import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MaintenanceRecovery } from '../desktop-ui/lib/maintenance-contract';

export function recoverySnapshot(directory: string, now = Date.now()): MaintenanceRecovery {
  let enabled = false;
  try { const policy = JSON.parse(fs.readFileSync(path.join(directory, 'recovery-policy.json'), 'utf8')); enabled = policy.version === 1 && policy.enabled === true; } catch { /* Missing or corrupt policy disables action. */ }
  const base = { enabled, available: false, fresh: false, checkedAt: null, status: 'Waiting for process recovery observation', attemptsToday: 0, receipts: [] };
  try {
    const state = JSON.parse(fs.readFileSync(path.join(directory, 'recovery.json'), 'utf8'));
    if (state.version !== 1 || !Number.isSafeInteger(state.checkedAt) || typeof state.status !== 'string' || !Array.isArray(state.attempts) || !state.attempts.every((a: unknown) => Number.isSafeInteger(a) && Number(a) > 0) || !Array.isArray(state.receipts) || !state.receipts.every((r: { at?: unknown; event?: unknown }) => r && Number.isSafeInteger(r.at) && typeof r.event === 'string')) throw new Error('Invalid recovery ledger');
    if (fs.existsSync(path.join(directory, 'recovery-error.json'))) return { ...base, status: 'Recovery evidence or ledger unavailable; automatic action blocked' };
    const day = (at: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
    const age = now - state.checkedAt * 1000;
    return { enabled, available: true, fresh: age >= 0 && age < 180_000, checkedAt: new Date(state.checkedAt * 1000).toISOString(), status: state.status,
      attemptsToday: state.attempts.filter((a: number) => day(a * 1000) === day(now)).length,
      receipts: state.receipts.slice(-10).reverse().map((r: { at: number; event: string }) => ({ at: new Date(r.at * 1000).toISOString(), event: r.event })) };
  } catch { return { ...base, status: 'Recovery ledger unavailable; automatic action blocked' }; }
}

export function setRecoveryEnabled(directory: string, enabled: boolean) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, 'recovery-policy.json');
  const temporary = `${target}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ version: 1, enabled, updatedAt: new Date().toISOString() })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, target);
  const directoryFd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
}
