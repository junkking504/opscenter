import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export type LogRotationHealth = { status: 'ok' | 'warn' | 'unknown'; summary: string; checkedAt: string | null };
export function rotationReceiptHealth(value: unknown, now = Date.now()): LogRotationHealth {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const checkedAt = typeof row.checkedAt === 'string' ? row.checkedAt : null;
  const age = checkedAt ? now - Date.parse(checkedAt) : NaN;
  if (row.status === 'failed' || row.status === 'retry') return { status: 'warn', summary: 'PostgreSQL log rotation needs attention; inspect its receipt.', checkedAt };
  if (!Number.isFinite(age) || age < 0 || !['rotated', 'below_threshold'].includes(String(row.status))) return { status: 'unknown', summary: 'PostgreSQL log rotation has no valid successful check.', checkedAt };
  if (age > 48 * 60 * 60_000) return { status: 'warn', summary: 'PostgreSQL log rotation has not checked successfully in 48 hours.', checkedAt };
  return { status: 'ok', summary: 'PostgreSQL log rotation check is current.', checkedAt };
}
export function readLogRotationHealth(directory = path.join(os.homedir(), 'Library/Logs/OpsCenter')): LogRotationHealth {
  let fd: number | undefined;
  try {
    fd = fs.openSync(path.join(directory, 'postgres-log-rotation-status.json'), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size > 16_384) throw new Error('Invalid receipt');
    return rotationReceiptHealth(JSON.parse(fs.readFileSync(fd, 'utf8')));
  } catch { return rotationReceiptHealth(null); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
