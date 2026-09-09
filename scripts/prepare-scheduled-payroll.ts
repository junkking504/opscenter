/** Local read-only payroll preparation. Delivery is performed by the scheduled task through Mail. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readDesktopKrewe } from '../lib/desktop-krewe';
import { buildPayrollReview } from '../desktop-ui/lib/payroll-review';
import { preparePayrollReportEmail } from '../desktop-ui/lib/payroll-report-email';
import { payrollReportDue, reservePayrollDelivery, confirmPayrollDelivery } from '../lib/payroll-report-schedule';

process.umask(0o077);
process.env.OPSBOT_DATA_DIR ||= path.join(os.homedir(), '.openclaw/workspace/opsbot/data');
const root = path.join(os.homedir(), 'Library/Application Support/OpsCenter/payroll-reports');
const [command = 'prepare', key, evidence] = process.argv.slice(2);
function main() {
  if (command === 'reserve' || command === 'confirm-sent') {
    if (!key || !/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('A prepared period key is required.');
    const directory = path.join(root, key);
    const message = JSON.parse(fs.readFileSync(path.join(directory, 'email.json'), 'utf8'));
    if (command === 'reserve') reservePayrollDelivery(directory, message.subject);
    else confirmPayrollDelivery(directory, evidence || '');
    return { status: command === 'reserve' ? 'reserved' : 'sent', period: key };
  }
  if (command !== 'prepare') throw new Error('Use prepare, reserve PERIOD, or confirm-sent PERIOD EVIDENCE.');
  const period = payrollReportDue();
  if (!period) return { status: 'not-due' };
  const periodKey = `${period.start}_${period.end}`;
  const directory = path.join(root, periodKey);
  const receiptFile = path.join(directory, 'delivery.json');
  if (fs.existsSync(receiptFile)) return { status: JSON.parse(fs.readFileSync(receiptFile, 'utf8')).status, period: periodKey, directory };
  const emailPath = path.join(directory, 'email.json');
  if (fs.existsSync(emailPath)) return { status: 'prepared', period: periodKey, directory, emailPath };
  const payroll = readDesktopKrewe(period.end, 'payperiod', 'admin');
  const hours = payroll.hoursSnapshot;
  if (!hours || hours.start !== period.start || hours.end !== period.end) throw new Error('Payroll and hours period do not match the completed period.');
  const rows = buildPayrollReview(hours, payroll);
  const missing = [...new Set([...hours.missingDates, ...payroll.missingDates])].sort();
  const warnings = [
    ...(missing.length ? [`Daily sources unavailable: ${missing.join(', ')}.`] : []),
    ...(payroll.excludedPayNames?.length ? [`Employees with recorded pay but no qualifying hours are excluded from totals: ${payroll.excludedPayNames.join(', ')}. Review their time records.`] : []),
    ...(!rows.length ? ['No employee hours are available. Do not treat this as zero payroll.'] : []),
  ];
  const message = preparePayrollReportEmail({ rows, ...period, retrievedAt: hours.generatedAt, warnings, totalEmployeeCount: rows.length, mode: 'scheduled' });
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  // Exclusive directory creation freezes a single matching body and attachment.
  // An interrupted preparation requires inspection instead of silent replacement.
  fs.mkdirSync(directory, { mode: 0o700 });
  const attachmentPath = path.join(directory, message.attachment.filename);
  fs.writeFileSync(attachmentPath, message.attachment.content, { mode: 0o600 });
  fs.writeFileSync(emailPath, JSON.stringify({ to: message.to, subject: message.subject, text: message.text, attachmentPath, period: periodKey, generatedAt: hours.generatedAt }, null, 2), { flag: 'wx', mode: 0o600 });
  return { status: 'prepared', period: periodKey, directory, emailPath };
}
console.log(JSON.stringify(main()));
