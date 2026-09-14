import fs from 'node:fs';
import path from 'node:path';

export type ClientRecovery = { failureAt: number; verifiedAt: number; evidence: string; actor: string };
const categoryAllowed = (key: string) => ['javascript', 'schedule', 'command', 'control'].includes(key);

// Separate receipts never rewrite the observer's budget/incident state. Matching
// the exact failure generation makes a concurrent/new failure invalidate proof.
export function readClientRecovery(key: string, directory: string): ClientRecovery | undefined {
  if (!categoryAllowed(key)) return;
  try {
    const value = JSON.parse(fs.readFileSync(path.join(directory, `verified-${key}.json`), 'utf8'));
    if (Number.isSafeInteger(value.failureAt) && Number.isSafeInteger(value.verifiedAt)
      && value.verifiedAt > value.failureAt && typeof value.evidence === 'string'
      && value.evidence.trim().length >= 20 && value.evidence.length <= 500
      && typeof value.actor === 'string' && value.actor.length > 0) return value;
  } catch { /* Missing/damaged proof cannot clear an incident. */ }
}

export function recordClientRecovery(key: string, failureAt: number, evidence: string, actor: string, directory: string, now = Date.now()) {
  if (!categoryAllowed(key) || !Number.isSafeInteger(failureAt) || !Number.isSafeInteger(now)
    || now <= failureAt || evidence.trim().length < 20 || evidence.length > 500 || !actor) return false;
  let current;
  try { current = JSON.parse(fs.readFileSync(path.join(directory, `${key}.json`), 'utf8')); } catch { return false; }
  if (current.at !== failureAt) return false;
  const target = path.join(directory, `verified-${key}.json`), temporary = `${target}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ failureAt, verifiedAt: now, evidence: evidence.trim(), actor })); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, target);
  return true;
}
