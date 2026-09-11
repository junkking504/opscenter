import fs from 'node:fs';
import path from 'node:path';
import { chicagoDateKey } from './chicago-date';
import type { PaymentReconciliation, PaymentByJobRow } from './payment-reconciliation';
import type { MerchantEvidence, MerchantReport, MerchantTransaction } from '../desktop-ui/lib/merchant-evidence-contract';

export type MerchantSnapshot = {
  schema: 1; date: string; collector: 'merchant-center-export' | 'merchant-center-detail';
  accountName: string; accountLastFour: string; collectedAt: string;
  complete: boolean; transactions: MerchantTransaction[];
};
const text = (v: unknown) => String(v ?? '').trim();
const cents = (v: number) => Math.round(v * 100);
const approved = (t: MerchantTransaction) => /^(approved|captured|settled|funded|deposited|paid)$/i.test(t.status)
  && /^(sale|charge)$/i.test(t.transactionType) && t.amount > 0;
const normalized = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nameMatches = (a: string, b: string) => {
  const aa = normalized(a).split(' ').filter(Boolean), bb = new Set(normalized(b).split(' ').filter(Boolean));
  return aa.length >= 2 && aa.filter(w => bb.has(w)).length >= Math.max(2, Math.ceil(aa.length * .5));
};
function validDate(v: string) { return /^20\d{2}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v; }
function freshAt(date: string, timestamp: string, now: number) {
  const elapsed = now - Date.parse(timestamp);
  return elapsed >= -60_000 && elapsed <= (date === chicagoDateKey(new Date(now)) ? 15 * 60_000 : 24 * 60 * 60_000);
}
export function validateMerchantSnapshot(value: unknown, date: string): MerchantSnapshot {
  const s = value as MerchantSnapshot;
  if (!s || s.schema !== 1 || !validDate(date) || s.date !== date
      || !['merchant-center-export', 'merchant-center-detail'].includes(s.collector)
      || s.accountName !== 'Junk Krewe' || s.accountLastFour !== '4618'
      || typeof s.complete !== 'boolean' || (s.complete && s.collector !== 'merchant-center-export')
      || !Number.isFinite(Date.parse(s.collectedAt)) || !Array.isArray(s.transactions)) throw new Error('Merchant Center account or report identity is invalid.');
  const ids = new Set<string>();
  for (const t of s.transactions) {
    if (!t || t.date !== date || !text(t.transactionId) || ids.has(t.transactionId)
      || !Number.isFinite(t.amount) || Math.abs(t.amount * 100 - cents(t.amount)) > 0.000001
      || !/^(\d{4})?$/.test(t.cardLastFour) || !text(t.status) || !text(t.transactionType)
      || typeof t.customer !== 'string' || typeof t.jkNumber !== 'string'
      || !Number.isFinite(Date.parse(t.observedAt)) || Date.parse(t.observedAt) > Date.parse(s.collectedAt) + 60_000 || (t.fee !== null && !Number.isFinite(t.fee))) throw new Error('Merchant Center transaction is invalid or duplicated.');
    ids.add(t.transactionId);
  }
  return s;
}
export function readMerchantSnapshot(date: string): { snapshot: MerchantSnapshot | null; issue: string | null } {
  if (!validDate(date)) return { snapshot: null, issue: 'Invalid report date.' };
  const root = process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data');
  const dir = path.join(root, 'imports/merchant_center/junk_krewe');
  try {
    const full = path.join(dir, `transactions-${date}.json`);
    const detail = path.join(dir, `details-${date}.json`);
    const fullSnapshot = fs.existsSync(full) ? validateMerchantSnapshot(JSON.parse(fs.readFileSync(full, 'utf8')), date) : null;
    const detailSnapshot = fs.existsSync(detail) ? validateMerchantSnapshot(JSON.parse(fs.readFileSync(detail, 'utf8')), date) : null;
    // A later full export supersedes observations. Never imply full coverage from individual details.
    const snapshot = fullSnapshot && (!detailSnapshot || Date.parse(fullSnapshot.collectedAt) >= Date.parse(detailSnapshot.collectedAt)) ? fullSnapshot
      : detailSnapshot ? { ...detailSnapshot, complete: false, transactions: [...new Map([...(fullSnapshot?.transactions || []), ...detailSnapshot.transactions].map(t => [t.transactionId, t])).values()] } : fullSnapshot;
    let refreshIssue: string | null = null;
    try {
      const refresh = JSON.parse(fs.readFileSync(path.join(dir, 'refresh.json'), 'utf8'));
      if (refresh.status === 'error') refreshIssue = 'Merchant Center automatic collection needs attention. Last verified evidence is retained.';
    } catch { /* No automatic collection status has been observed. */ }
    return { snapshot, issue: refreshIssue || (snapshot ? null : 'Merchant Center has not been collected for this date.') };
  } catch { return { snapshot: null, issue: 'Merchant Center report could not be verified. Refresh its source.' }; }
}
/** One-to-one matching. Processor evidence never supplies a fabricated QBO reference. */
export function reconcileMerchantEvidence(rows: PaymentByJobRow[], payload: PaymentReconciliation | null, snapshot: MerchantSnapshot | null, issue: string | null = null, now = Date.now()): { paymentsByJob: PaymentByJobRow[]; processor: MerchantReport } {
  const fresh = Boolean(snapshot && freshAt(snapshot.date, snapshot.collectedAt, now) && snapshot.transactions.every(t => freshAt(t.date, t.observedAt, now)));
  const transactions = snapshot?.transactions || [];
  const candidates = rows.map(row => transactions.filter(t => t.date === row.date && cents(t.amount) === cents(row.paidAmount)
    && (!t.jkNumber || t.jkNumber === row.jkNumber)
    && (!t.cardLastFour || !row.cardLastFour || t.cardLastFour === row.cardLastFour)
    && (t.jkNumber === row.jkNumber || (t.cardLastFour && t.cardLastFour === row.cardLastFour) || nameMatches(t.customer, row.customer))));
  const uses = new Map<string, number>();
  candidates.flat().forEach(t => uses.set(t.transactionId, (uses.get(t.transactionId) || 0) + 1));
  const claimed = new Set<string>();
  const paymentsByJob = rows.map((row, index) => {
    const options = candidates[index];
    const t = options.length === 1 && uses.get(options[0].transactionId) === 1 ? options[0] : null;
    if (t) claimed.add(t.transactionId);
    const evidence: MerchantEvidence = { state: t ? approved(t) ? 'approved' : 'review' : options.length ? 'ambiguous' : snapshot?.complete ? 'not_found' : 'unavailable', transaction: t, fresh: t ? freshAt(t.date, t.observedAt, now) : fresh };
    return { ...row, processor: evidence };
  });
  const qbo = payload?.sources.merchant_center.collector === 'qbo-accounting-api' ? [
    ...(payload.matches || []).map(m => m.merchant_center), ...(payload.exceptions.merchant_center_only || []),
    ...(payload.exceptions.amount_mismatch || []).map(m => m.merchant_center),
  ] : [];
  const qboCandidates = transactions.map(t => qbo.filter(q => q.date === t.date && cents(q.amount) === cents(t.amount) && Boolean(q.card_last_four && q.card_last_four === t.cardLastFour)));
  const qboUses = new Map<string, number>();
  qboCandidates.flat().forEach(q => qboUses.set(q.transaction_id, (qboUses.get(q.transaction_id) || 0) + 1));
  const unmatched = transactions.flatMap((t, index) => {
    if (claimed.has(t.transactionId)) return [];
    const matches = qboCandidates[index];
    const match = matches.length === 1 && qboUses.get(matches[0].transaction_id) === 1 ? matches[0] : null;
    return [{ transaction: t, qboTransactionId: match?.transaction_id || null, reason: uses.has(t.transactionId) ? 'Ambiguous job match' : match ? 'Recorded in QBO; job match needs review' : 'Job and QBO match need review' }];
  });
  const sales = transactions.filter(approved);
  return { paymentsByJob, processor: { available: Boolean(snapshot), fresh, complete: Boolean(snapshot?.complete), collectedAt: snapshot?.collectedAt || null,
    approvedTotal: snapshot ? cents(sales.reduce((sum, t) => sum + t.amount, 0)) / 100 : null, approvedCount: sales.length, issue,
    unmatched } };
}
