import fs from 'node:fs';
import path from 'node:path';

export type DumpExpenseConfirmation = {
  date: string;
  expenseId: string;
  visitId: string;
  confirmedAt: string;
  confirmedBy: string;
  note: string;
};

export function parseDumpExpenseConfirmations(value: unknown): DumpExpenseConfirmation[] | null {
  const rows = Array.isArray(value) ? value : (value as { confirmations?: unknown })?.confirmations;
  if (!Array.isArray(rows)) return null;
  const result: DumpExpenseConfirmation[] = [];
  const expenses = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null;
    const confirmation = row as Record<string, unknown>;
    const parsed = {
      date: String(confirmation.date || ''),
      expenseId: String(confirmation.expenseId || ''),
      visitId: String(confirmation.visitId || ''),
      confirmedAt: String(confirmation.confirmedAt || ''),
      confirmedBy: String(confirmation.confirmedBy || '').trim(),
      note: String(confirmation.note || '').trim(),
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) || !/^[a-f0-9]{32}$/.test(parsed.expenseId)
      || !/^linxup-geofence-[a-f0-9]{32}$/.test(parsed.visitId) || !Number.isFinite(Date.parse(parsed.confirmedAt))
      || !parsed.confirmedBy || !parsed.note || expenses.has(parsed.expenseId)) return null;
    expenses.add(parsed.expenseId);
    result.push(parsed);
  }
  return result;
}

export function readDumpExpenseConfirmations(date: string): DumpExpenseConfirmation[] {
  const root = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data');
  try {
    const parsed = parseDumpExpenseConfirmations(JSON.parse(fs.readFileSync(path.join(root, 'config', 'dump-expense-confirmations.json'), 'utf8')));
    return parsed?.filter(row => row.date === date) || [];
  } catch { return []; }
}
