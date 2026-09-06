import type { AnyRecord } from './opsData';
import type { PaymentReconciliationView } from './payment-reconciliation';
import type { FinanceData } from '../desktop-ui/lib/commercial-contract';

const text = (value: unknown) => String(value ?? '').trim();
const amount = (value: unknown): number | null => {
  if (value == null || text(value) === '') return null;
  const parsed = Number(text(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const cents = (value: number) => Math.round(value * 100) / 100 || 0;

/** Add source-recorded cash/check tenders without changing the card reconciliation ledger. */
export function desktopPayments(date: string, reconciliation: PaymentReconciliationView, sourceRows: AnyRecord[]): FinanceData['reconciliation'] {
  const jobs = new Map<string, AnyRecord>();
  for (const row of sourceRows) {
    if (row.appointment_date && text(row.appointment_date).slice(0, 10) !== date) continue;
    const jk = text(row.job_id || row.jk_number || row.job_number);
    const identity = text(row.appt_id || row.appointment_id || jk);
    if (jk && identity && !jobs.has(identity) && Array.isArray(row.closeout?.payments)) jobs.set(identity, row);
  }
  const rows = [...jobs.values()];
  const byJk = (jk: string) => rows.filter(row => text(row.job_id || row.jk_number || row.job_number) === jk);
  const jobDifference = (row: AnyRecord): number | null => {
    const revenue = amount(row.revenue ?? row.job_total);
    const tip = amount(row.closeout?.tip ?? row.tip) ?? 0;
    const values = row.closeout.payments.map((payment: AnyRecord) => amount(payment.amount));
    return revenue == null || !values.length || values.some((value: number | null) => value == null) ? null
      : cents(values.reduce((sum: number, value: number) => sum + value, 0) - revenue - tip);
  };
  const payments: FinanceData['reconciliation']['paymentsByJob'] = reconciliation.paymentsByJob.map(payment => {
    const matches = byJk(payment.jkNumber);
    const row = matches.length === 1 ? matches[0] : null;
    return { ...payment, tender: 'card', truck: row ? text(row.truck || row.assigned_truck) : '',
      jobDifference: row ? jobDifference(row) : payment.revenueAmount != null && payment.tipAmount != null ? cents(payment.paidAmount - payment.revenueAmount - payment.tipAmount) : null };
  });
  let cashTotal = 0, checkTotal = 0;
  for (const row of rows) {
    const tenders = row.closeout.payments as AnyRecord[];
    for (const payment of tenders) {
      const method = text(payment.method || payment.payment_method);
      const tender = /\bchecks?\b|\bcheques?\b/i.test(method) ? 'check' : /\bcash\b/i.test(method) ? 'cash' : null;
      const paid = amount(payment.amount ?? payment.payment_amount);
      if (!tender || paid == null) continue;
      const checkNumber = tender === 'check' ? (text(payment.check_number) || text(payment.checkNumber) || text(payment.detail)).replace(/^(?:check\s*)?(?:number|no\.?)?\s*#?\s*/i, '').trim() : '';
      if (tender === 'cash') cashTotal += paid; else checkTotal += paid;
      payments.push({ date, jkNumber: text(row.job_id || row.jk_number || row.job_number), customer: text(row.customer_name || row.customerName) || 'Unavailable',
        truck: text(row.truck || row.assigned_truck), paymentMethod: tender === 'check' ? 'Check' : 'Cash', tender, checkNumber,
        paidAmount: paid, revenueAmount: amount(row.revenue ?? row.job_total),
        tipAmount: tenders.length === 1 ? amount(row.closeout.tip ?? row.tip) ?? 0 : amount(payment.tip),
        jobDifference: jobDifference(row), qboTransactionId: null, qboStatus: null, reconciliation: 'Recorded',
      });
    }
  }
  return { ...reconciliation, paymentsByJob: payments.sort((a,b) => a.jkNumber.localeCompare(b.jkNumber)),
    recordedPayments: { total: payments.length || reconciliation.status !== 'not_collected' ? cents(payments.reduce((sum, row) => sum + row.paidAmount, 0)) : null,
      cash: cents(cashTotal), check: cents(checkTotal) } };
}
