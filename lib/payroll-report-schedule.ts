import fs from 'node:fs';
import path from 'node:path';
import { addDateKeyDays, payPeriodForDate } from './pay-period';

/** Local wall-clock schedule survives daylight-saving changes. Off Mondays do nothing. */
export function payrollReportDue(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  if (new Date(`${date}T12:00:00Z`).getUTCDay() !== 1 || Number(parts.hour) < 8) return null;
  const end = addDateKeyDays(date, -1);
  const period = payPeriodForDate(end);
  return period.end === end ? period : null;
}

export function reservePayrollDelivery(directory: string, subject: string) {
  // An uncertain attempt remains reserved. Never retry an ambiguous send automatically.
  fs.writeFileSync(path.join(directory, 'delivery.json'), JSON.stringify({ status: 'sending', subject, attemptedAt: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });
}
export function confirmPayrollDelivery(directory: string, evidence: string) {
  if (!evidence.trim()) throw new Error('Sent-folder verification evidence is required.');
  const file = path.join(directory, 'delivery.json');
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (receipt.status !== 'sending') throw new Error('Only a reserved attempt can be confirmed.');
  fs.writeFileSync(file, JSON.stringify({ ...receipt, status: 'sent', confirmedAt: new Date().toISOString(), evidence }, null, 2), { mode: 0o600 });
}
