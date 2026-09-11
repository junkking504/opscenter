import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readRecyclingData, recyclingDirectory } from './recycling-receipt-store';
import { formatSlackMessage } from './slack-message-format';
import type { RecyclingRecord } from '../desktop-ui/lib/commercial-contract';

type Alert = { id: string; text: string };
type Receipt = { channel: string; ts: string; hash: string };
type DeliveryState = { version: 1; messages: Record<string, Receipt> };
type SlackReply = { ok: boolean; ts?: string; error?: string };
const money = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
const sum = (rows: RecyclingRecord[]) => rows.reduce((total, row) => total + Math.round((row.realizedValue ?? 0) * 100), 0) / 100;

export function buildRecyclingSlackAlerts(store: ReturnType<typeof readRecyclingData>, origin = 'https://ops.junk-king.app'): Alert[] {
  const link = (month: string) => `${origin}/desktop?workspace=Finance&financeView=recycling${month ? `&recyclingMonth=${month}` : ''}`;
  const alerts: Alert[] = [];
  const groups = new Map<string, RecyclingRecord[]>();
  for (const row of store.records) {
    const key = row.statementId || row.id;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  for (const draft of store.receiptDrafts || []) {
    if (draft.status !== 'review') continue;
    const dates = draft.rows.map(row => row.date).filter(Boolean).sort();
    alerts.push({ id: `receipt:${draft.id}`, text: formatSlackMessage({
      icon: ':recycle:', title: 'Metal Recycling · Receipt Needs Review',
      fields: [{ label: 'Yard', value: draft.yard || 'Not yet identified' },
        { label: 'Photos', value: draft.photos.length },
        { label: 'Extracted lines', value: draft.rows.length },
        { label: 'Receipt total (unreviewed)', value: draft.total == null ? 'Needs review' : money(draft.total) }],
      body: 'Photo extraction is a draft. Revenue and payment have not been recorded from this receipt.',
      nextAction: 'Check all pages and the daily breakdown in Finance → Recycling.', href: link(dates[0]?.slice(0, 7) || ''),
    }) });
  }
  for (const [id, rows] of groups) {
    const dates = [...new Set(rows.map(row => row.date))].sort();
    const paid = rows.filter(row => row.status === 'Paid');
    const paymentDates = [...new Set(paid.map(row => row.paymentDate || 'Date needs review'))].sort();
    const unknown = rows.some(row => row.realizedValue == null);
    const daily = dates.map(date => `${date}: ${rows.filter(row => row.date === date).some(row => row.realizedValue == null) ? 'Value not recorded' : money(sum(rows.filter(row => row.date === date)))}`);
    alerts.push({ id: `receipt:${id}`, text: formatSlackMessage({
      icon: ':recycle:', title: 'Metal Recycling · Runs Recorded',
      fields: [{ label: 'Yard', value: [...new Set(rows.map(row => row.yard || 'Not recorded'))].join('; ') },
        { label: 'Run / ticket dates', value: dates.length === 1 ? dates[0] : `${dates[0]} through ${dates.at(-1)}` },
        { label: 'Daily entries', value: rows.length },
        { label: 'Recorded run value', value: unknown ? `${money(sum(rows))} known; some values missing` : money(sum(rows)) },
        { label: 'Payment received', value: paid.length ? `${paid.some(row => row.realizedValue == null) ? 'Amount needs review' : money(sum(paid))} · ${paymentDates.join(', ')}` : 'Not recorded' }],
      body: [...daily.slice(0, 31), ...(daily.length > 31 ? [`${daily.length - 31} more days in OpsCenter.`] : []),
        'Run value and payment are the same income, not two separate amounts.'].join('\n'),
      href: link(dates[0]?.slice(0, 7) || ''),
    }) });
  }
  return alerts;
}

async function slackSend(token: string, channel: string, text: string, ts?: string): Promise<SlackReply> {
  const response = await fetch(`https://slack.com/api/${ts ? 'chat.update' : 'chat.postMessage'}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ channel, text, ...(ts ? { ts } : {}), mrkdwn: true, unfurl_links: false, unfurl_media: false }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json() as SlackReply;
  if (!response.ok) return { ok: false, error: result.error || `HTTP ${response.status}` };
  return result;
}

/** Existing photo-worker cadence owns delivery; durable receipts survive release changes. */
export async function deliverRecyclingSlackAlerts(options: {
  dryRun?: boolean;
  send?: typeof slackSend;
} = {}) {
  const result = { posted: 0, updated: 0, unchanged: 0, skipped: false, failures: [] as string[], preview: [] as Alert[] };
  if (!options.dryRun && !/^(true|1|yes|on)$/i.test(process.env.SLACK_OPSCENTER_ALERTS_ENABLED || '')) { result.skipped = true; return result; }
  const directory = recyclingDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, '.slack-delivery-lock');
  // Never remove a live owner's lock. Unknown owners require investigation.
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Recycling Slack delivery lock has no valid owner');
    try { process.kill(pid, 0); result.skipped = true; return result; }
    catch (ownerError) {
      if ((ownerError as NodeJS.ErrnoException).code !== 'ESRCH') { result.skipped = true; return result; }
      fs.unlinkSync(lock);
      // Retry on the next worker cycle after reclaiming a demonstrably dead owner.
      result.skipped = true; return result;
    }
  }
  try {
    const file = path.join(directory, 'slack-deliveries.json');
    let state: DeliveryState;
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; state = { version: 1, messages: {} }; }
    if (state.version !== 1 || !state.messages || typeof state.messages !== 'object' || Array.isArray(state.messages)) throw new Error('Recycling Slack delivery history requires recovery');
    const alerts = buildRecyclingSlackAlerts(readRecyclingData());
    const channel = process.env.SLACK_OPS_PAYMENT_CHANNEL_ID || 'C0BPS5MS406';
    const token = process.env.SLACK_BOT_TOKEN || '';
    for (const alert of alerts) {
      const hash = createHash('sha256').update(alert.text).digest('hex');
      const saved = state.messages[alert.id];
      if (saved && (!saved.channel || !saved.ts || !saved.hash)) throw new Error('Invalid recycling Slack delivery receipt');
      if (saved?.hash === hash) { result.unchanged++; continue; }
      result.preview.push(alert);
      if (options.dryRun) continue;
      if (!token) throw new Error('SLACK_BOT_TOKEN is required for recycling alerts');
      try {
        const reply = await (options.send || slackSend)(token, saved?.channel || channel, alert.text, saved?.ts);
        if (!reply.ok || (!saved && !reply.ts)) { result.failures.push(reply.error || 'Slack returned no receipt'); continue; }
        state.messages[alert.id] = { channel: saved?.channel || channel, ts: saved?.ts || reply.ts!, hash };
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
        fs.renameSync(`${file}.tmp`, file);
        if (saved) result.updated++; else result.posted++;
      } catch (error) { result.failures.push(error instanceof Error ? error.message : String(error)); }
    }
    return result;
  } finally { fs.unlinkSync(lock); }
}
