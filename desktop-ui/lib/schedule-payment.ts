import { appointmentCategory, type ScheduleAppointment } from './schedule-contract';

const dollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
export function schedulePayment(job: ScheduleAppointment) {
  const source = job.closeout;
  if (appointmentCategory(job) === 'Estimate') return { tone: 'quote', label: 'Estimate quoted', amount: dollars(source?.total ?? job.paymentAmount), details: ['Quote only · not a payment'], balance: null };
  if (job.chargeDetailsPending || !source) return { tone: 'unknown', label: job.chargeDetailsPending ? 'Payment updating' : 'Payment details unavailable', amount: null, details: job.paymentAmount > 0 ? [`Listed amount ${dollars(job.paymentAmount)} · not verified paid`] : ['No payment detail in this snapshot'], balance: null };
  const billed = source.payments.filter(row => /\bbill(?:ed|ing)?\b|invoice|accounts? receivable/i.test(row.method));
  const payments = source.payments.filter(row => !billed.includes(row));
  const received = Math.round(payments.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
  const valid = [source.tip, source.balance, received, ...payments.map(row => row.amount)].every(Number.isFinite) && received >= 0 && source.tip >= 0;
  if (!valid || (received > 0 && source.tip > received)) return { tone: 'unknown', label: 'Payment needs review', amount: null, details: ['Payment and tip amounts do not reconcile'], balance: null };
  const net = Math.round(Math.max(0, received - source.tip) * 100) / 100;
  return {
    tone: source.balance > 0 ? 'due' : received > 0 ? 'paid' : 'unknown',
    label: received > 0 ? 'Job paid · excluding tips' : billed.length ? 'Billed · not confirmed paid' : 'No payment recorded',
    amount: received > 0 ? dollars(net) : null,
    details: [
      ...new Set(payments.map(row => `${row.method.trim() || 'Method not recorded'}${payments.length > 1 ? ` · ${dollars(row.amount)} received` : ''}`)),
      ...(source.tip > 0 && received > 0 ? [`Tip ${dollars(source.tip)} · received ${dollars(received)} incl. tip`] : []),
      ...(billed.length ? [`Billed ${dollars(billed.reduce((sum, row) => sum + row.amount, 0))}`] : []),
    ],
    balance: source.balance > 0 ? `Balance due ${dollars(source.balance)}` : source.balance < 0 ? `Credit balance ${dollars(Math.abs(source.balance))}` : received > 0 ? 'Balance $0.00' : null,
  };
}
