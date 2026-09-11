import type { FinanceData } from './commercial-contract';

type Reconciliation = FinanceData['reconciliation'];
type Payment = Reconciliation['paymentsByJob'][number];
const isCard = (row: Payment) => row.tender !== 'cash' && row.tender !== 'check';

/** A recorded processor approval verifies its matched payment, even if QBO has not posted it. */
export function paymentVerification(row: Payment, qboUsable: boolean) {
  if (!isCard(row)) return 'Recorded';
  if (row.processor?.state === 'approved' && row.processor.transaction) return 'Verified · Merchant Center';
  if (qboUsable && row.reconciliation === 'Matched' && row.qboTransactionId) return 'Verified · QBO';
  return 'Needs verification';
}

/** Sum job payments once; accounting-only records remain in the separate QBO comparison. */
export function verifiedPayments(recon: Reconciliation) {
  const qboUsable = recon.merchantCenterAvailable && recon.merchantCenterFresh;
  const cards = recon.paymentsByJob.filter(isCard);
  const verified = cards.filter(row => paymentVerification(row, qboUsable).startsWith('Verified'));
  const sum = (rows: Payment[]) => rows.reduce((total, row) => total + Math.round(row.paidAmount * 100), 0) / 100;
  const available = recon.status !== 'not_collected' || cards.length > 0;
  const total = sum(verified);
  const difference = Math.round((total - sum(cards)) * 100) / 100;
  return { available, qboUsable, count: verified.length, total: available ? total : null,
    difference: available ? difference : null, unresolvedCount: cards.length - verified.length,
    status: !available ? 'Not collected' : verified.length === cards.length ? 'Verified' : 'Needs verification' };
}
