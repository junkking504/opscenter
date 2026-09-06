import type { AnyRecord } from './opsData';
import type { PaymentReconciliationView } from './payment-reconciliation';
import type { EssentialFact } from './operational-alert-presentation';

export function closeoutPaymentFacts(row: AnyRecord, reconciliation: PaymentReconciliationView): EssentialFact[] {
  const jk = String(row.job_id || row.jk_number || row.job_number || '').toUpperCase();
  const payments = (Array.isArray(row.closeout?.payments) ? row.closeout.payments : []).map((p: AnyRecord) => {
    const method = String(p.method || p.payment_method || p.paymentMethod || '').trim();
    const detail = String(p.detail || p.payment_detail || p.paymentDetail || '');
    const raw = p.amount ?? p.payment_amount ?? p.paymentAmount;
    const amount = raw === null || raw === undefined || raw === '' ? null : Number(String(raw).replace(/[$,]/g, ''));
    return { method: /check/i.test(method) && detail ? `Check #${detail.replace(/^#/, '')}` : method, amount: amount !== null && Number.isFinite(amount) ? amount : null, lastFour: detail.match(/(\d{4})(?!.*\d)/)?.[1] || '' };
  }).filter((p: { method: string }) => p.method);
  if (!payments.length) return [{ label: 'Payment', value: 'Not recorded' }];
  const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const facts: EssentialFact[] = [{ label: 'Payment', value: payments.map((p: { method: string; amount: number | null; lastFour: string }) => `${/card/i.test(p.method) ? `Card${p.lastFour ? ` ending ${p.lastFour}` : ''}` : p.method}${p.amount === null ? ' (amount unavailable)' : ` (${money(p.amount)})`}`).join('; ') }];
  const cards = payments.filter((p: { method: string }) => /card/i.test(p.method));
  if (!cards.length) return facts;
  let verification = 'Awaiting QuickBooks verification';
  const references: string[] = [];
  if (reconciliation.merchantCollector === 'qbo-accounting-api' && reconciliation.merchantCenterAvailable && reconciliation.merchantCenterFresh) {
    const rows = reconciliation.paymentsByJob.filter(p => p.jkNumber.toUpperCase() === jk);
    const used = new Set<string>();
    const allMatched = cards.every((card: { amount: number | null; lastFour: string }) => {
      if (card.amount === null || card.amount <= 0) return false;
      const candidates = rows.filter(p => p.reconciliation === 'Matched' && p.qboTransactionId && !used.has(p.qboTransactionId)
        && !/void|fail|declin|refund|cancel/i.test(p.qboStatus || '')
        && Math.round(p.paidAmount * 100) === Math.round(card.amount! * 100)
        && (!card.lastFour || p.cardLastFour === card.lastFour));
      if (candidates.length !== 1) return false;
      used.add(candidates[0].qboTransactionId!);
      references.push(candidates[0].qboTransactionId!);
      return true;
    });
    verification = rows.some(p => p.reconciliation === 'Needs review') ? 'Needs review · QuickBooks payment mismatch or ambiguous match'
      : allMatched ? 'Verified against QuickBooks'
      : rows.some(p => p.reconciliation === 'Missing in QBO') ? 'Awaiting matching QuickBooks entry'
      : 'Awaiting matching QuickBooks payment amount and card';
  } else if (reconciliation.merchantCenterAvailable && !reconciliation.merchantCenterFresh) {
    verification = 'Awaiting fresh QuickBooks data';
  }
  facts.push({ label: 'Card verification', value: verification });
  if (verification === 'Verified against QuickBooks') facts.push({ label: 'QuickBooks entry', value: references.join(', '), href: `/desktop?workspace=Finance&financeView=payments&date=${encodeURIComponent(reconciliation.paymentsByJob.find(p => p.jkNumber.toUpperCase() === jk)?.date || '')}` });
  return facts;
}
