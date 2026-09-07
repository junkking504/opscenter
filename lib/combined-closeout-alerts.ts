import { toOperationalAlert, type OperationalAlert } from './operational-alert-presentation';
import { applyClockOutCorrections, consolidateCrewClockOutAlerts } from './crew-clock-out-alerts';
import { closeoutPaymentFacts } from './closeout-payment-verification';
import type { SlackDigestMessage } from './slack-digest';
import type { PaymentReconciliationView } from './payment-reconciliation';
import type { AnyRecord } from './opsData';

export function combinedCloseoutAlerts(messages: SlackDigestMessage[], completed: AnyRecord[], reconciliation: PaymentReconciliationView, crewCorrections?: Parameters<typeof applyClockOutCorrections>[1]): OperationalAlert[] {
  const presented = applyClockOutCorrections(consolidateCrewClockOutAlerts(messages.map(toOperationalAlert)),crewCorrections);
  const jobKey = (alert: OperationalAlert) => alert.title.match(/\bJK\d+\b/i)?.[0].toUpperCase();
  const closeouts = new Map<string, OperationalAlert>();
  for (const alert of presented) {
    const key = jobKey(alert);
    if (key && alert.label === 'Job Closed' && !closeouts.has(key)) closeouts.set(key, alert);
  }
  return presented.flatMap(alert => {
    const key = jobKey(alert);
    const canonical = key ? closeouts.get(key) : undefined;
    if (canonical && alert !== canonical && ['Job Closed', 'Payment Recorded'].includes(alert.label)) return [];
    if (alert.label !== 'Job Closed') return [alert];
    const row = completed.find(row => String(row.job_id || row.jk_number || row.job_number || '').toUpperCase() === key);
    const related = presented.filter(item => jobKey(item) === key && item.label === 'Payment Recorded');
    const recorded = related.flatMap(item => item.facts.filter(f=>/^payments?$/i.test(f.label)));
    const paymentFacts = row?.closeout?.payments?.length ? closeoutPaymentFacts(row, reconciliation) : recorded.length ? [...recorded, ...(/card/i.test(recorded.map(f=>f.value).join(' ')) ? [{ label: 'Card verification', value: 'Awaiting current closeout payment details' }] : [])] : row ? closeoutPaymentFacts(row, reconciliation) : [{ label: 'Payment verification', value: 'Awaiting current closeout payment details' }];
    const facts = alert.facts.filter(f => !/^(payment|payments|card ending|cash|check|card verification|quickbooks entry)$/i.test(f.label)).map(f => ({ ...f, label: /^total$/i.test(f.label) ? 'Job total' : f.label }));
    return [{ ...alert, sourceMessageIds: Array.from(new Set(presented.filter(item => jobKey(item) === key && ['Job Closed','Payment Recorded'].includes(item.label)).flatMap(item => item.sourceMessageIds || [item.id]))), facts: [...facts, ...paymentFacts], next: 'Review closeout, payment verification, and photos.' }];
  });
}
