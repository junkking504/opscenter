import type { FinanceData } from './commercial-contract';
import type { QboPaymentReference } from './payment-source-reference';
import type { MerchantTransaction } from './merchant-evidence-contract';
export type Payment = FinanceData['reconciliation']['paymentsByJob'][number];
export type CrosscheckFilter = 'all' | 'cards' | 'accounting' | 'cash' | 'processor';
export type PaymentIssue = {
  id: string; date: string; reference: string; customer: string; reasons: string[];
  categories: CrosscheckFilter[]; payment?: Payment; appointmentId?: string | null;
  recorded: number | null; card: string; qbo: QboPaymentReference[];
  possibleQbo: QboPaymentReference[]; processor?: MerchantTransaction;
};
export function qboTransactionHref(id?: string | null, type?: string | null) {
  const route = type === 'SalesReceipt' ? 'salesreceipt' : type === 'Payment' ? 'recvpayment' : null;
  return route && id && /^\d+$/.test(id) ? `https://qbo.intuit.com/app/${route}?txnId=${encodeURIComponent(id)}` : null;
}
export function junkwareTransactionHref(id?: string | null) {
  return id && /^\d+$/.test(id) ? `https://junkware.junk-king.com/franchise/appointment.aspx?id=${encodeURIComponent(id)}` : null;
}
const cents = (amount: number) => Math.round(amount * 100);
const lastFour = (value: string) => /^\d{4}$/.test(value.trim()) ? value.trim() : '';
/** Navigation only: candidate hints never modify matching or verification. */
export function paymentIssues(recon: FinanceData['reconciliation'], status: (payment: Payment) => string): PaymentIssue[] {
  const issues: PaymentIssue[] = [];
  const accounted = new Set<FinanceData['reconciliation']['exceptions'][number]>();
  for (const [index, payment] of recon.paymentsByJob.entries()) {
    const cash = payment.tender === 'cash' || payment.tender === 'check';
    const exceptions = recon.exceptions.filter(ex => ex.type !== 'QBO only' && ex.date === payment.date && ex.reference === payment.jkNumber && ex.junkwareAmount != null && cents(ex.junkwareAmount) === cents(payment.paidAmount));
    // Split tenders with the same amount cannot select an arbitrary source row.
    const unique = recon.paymentsByJob.filter(row => row.date === payment.date && row.jkNumber === payment.jkNumber && cents(row.paidAmount) === cents(payment.paidAmount)).length === 1;
    const linked = unique ? exceptions : [];
    linked.forEach(ex => accounted.add(ex));
    const reasons = linked.map(ex => ex.type);
    const categories: CrosscheckFilter[] = linked.length ? ['accounting'] : [];
    if (status(payment) === 'Needs verification') { reasons.unshift(cash ? 'Cash/check needs verification' : 'Card needs verification'); categories.push(cash ? 'cash' : 'cards'); }
    if (payment.jobDifference != null && cents(payment.jobDifference) !== 0) { reasons.push('Job total differs from payments'); }
    if (payment.processor?.state === 'review' || payment.processor?.state === 'ambiguous') { reasons.push('Processor needs review'); categories.push('processor'); }
    if (!reasons.length) continue;
    const qbo = linked.flatMap(ex => ex.qboTransactions || []);
    if (!qbo.length && payment.qboTransactionId) qbo.push(payment.qboTransaction || { id: payment.qboTransactionId, type: payment.qboTransactionType || '', date: '', amount: null, cardLastFour: '', customer: '', status: payment.qboStatus || '' });
    issues.push({ id: `job-${payment.date}-${payment.jkNumber}-${index}`, date: payment.date, reference: payment.jkNumber, customer: payment.customer, reasons, categories, payment,
      appointmentId: payment.appointmentId || linked.find(ex => ex.appointmentId)?.appointmentId,
      recorded: payment.paidAmount, card: lastFour(payment.cardLastFour || ''), qbo, possibleQbo: [] });
  }
  for (const [index, ex] of recon.exceptions.entries()) {
    if (accounted.has(ex)) continue;
    issues.push({ id: `accounting-${ex.date}-${ex.reference}-${index}`, date: ex.date, reference: ex.reference, customer: ex.customer, reasons: [ex.type], categories: ['accounting'], appointmentId: ex.appointmentId,
      recorded: ex.junkwareAmount, card: lastFour(ex.cardLastFour || ''), qbo: ex.qboTransactions || [], possibleQbo: [] });
  }
  for (const issue of issues) {
    if (!issue.reasons.includes('Missing in QBO') || !issue.card) continue;
    issue.possibleQbo = recon.exceptions.filter(ex => ex.type === 'QBO only').flatMap(ex => ex.qboTransactions || [])
      .filter(tx => tx.date === issue.date && lastFour(tx.cardLastFour) === issue.card);
  }
  for (const [index, row] of (recon.processor?.unmatched || []).entries()) {
    const tx = row.transaction;
    issues.push({ id: `processor-${tx.transactionId}-${index}`, date: tx.date, reference: tx.transactionId, customer: tx.customer, reasons: [row.reason], categories: ['processor'], recorded: null, card: lastFour(tx.cardLastFour), qbo: [], possibleQbo: [], processor: tx });
  }
  return issues;
}
