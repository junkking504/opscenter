import { createHash } from 'node:crypto';
import type { RecyclingRecord } from '../desktop-ui/lib/commercial-contract';

export type RecyclingStatement = {
  amount_usd: string; payment_received_date: string; unique_ticket_count: number; net_commodity_weight_lb: number;
  rows: Array<{ date: string; ticket: string; commodity: string; printed_net_lb: number; amount_usd: string }>;
};
const version = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cents = (value: string) => { if (!/^\d+\.\d{2}$/.test(value)) throw new Error('Invalid statement amount'); return Math.round(Number(value) * 100); };
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;

/** One daily entry per printed ticket date; the payment remains on its received date. */
export function splitRecyclingStatement(source: RecyclingRecord, statement: RecyclingStatement, stamp: string): RecyclingRecord[] {
  if (source.status !== 'Paid' || source.realizedValue == null || !validDate(statement.payment_received_date)) throw new Error('A confirmed paid source and payment date are required');
  if (!statement.rows.length || cents(statement.amount_usd) !== Math.round(source.realizedValue * 100)) throw new Error('Statement and original payment do not reconcile');
  const ticketDates = new Map<string, string>();
  for (const row of statement.rows) {
    if (!validDate(row.date) || !row.ticket || !row.commodity || !Number.isFinite(row.printed_net_lb) || row.printed_net_lb < 0) throw new Error('Invalid ticket evidence');
    if (ticketDates.has(row.ticket) && ticketDates.get(row.ticket) !== row.date) throw new Error('Ticket has conflicting dates');
    ticketDates.set(row.ticket, row.date);
    if (row.commodity === 'WEIGHT DEDUCTION' && cents(row.amount_usd) !== 0) throw new Error('Nonzero weight deduction needs review');
  }
  if (ticketDates.size !== statement.unique_ticket_count) throw new Error('Ticket count does not reconcile');
  if (statement.rows.reduce((sum, row) => sum + cents(row.amount_usd), 0) !== cents(statement.amount_usd)) throw new Error('Line amounts do not reconcile');
  if (statement.rows.filter(row => row.commodity !== 'WEIGHT DEDUCTION').reduce((sum, row) => sum + row.printed_net_lb, 0) !== statement.net_commodity_weight_lb) throw new Error('Printed commodity weights do not reconcile');
  return [...new Set(statement.rows.map(row => row.date))].sort().map(date => {
    const lines = statement.rows.filter(row => row.date === date);
    const commodities = lines.filter(row => row.commodity !== 'WEIGHT DEDUCTION');
    const tickets = [...new Set(lines.map(row => row.ticket))];
    const amount = lines.reduce((sum, row) => sum + cents(row.amount_usd), 0) / 100;
    const weight = commodities.reduce((sum, row) => sum + row.printed_net_lb, 0);
    const idHash = version({ source: source.id, date });
    const id = `${idHash.slice(0,8)}-${idHash.slice(8,12)}-4${idHash.slice(13,16)}-8${idHash.slice(17,20)}-${idHash.slice(20,32)}`;
    const value = {
      id, date, paymentDate: statement.payment_received_date, statementId: source.id, dateBasis: 'yard_ticket' as const,
      material: commodities.every(row => row.commodity === 'FRAG FEED') ? 'Scrap metal · FRAG FEED' : 'Scrap metal · mixed commodities',
      sourceJob: source.sourceJob, yard: source.yard, quantity: `${weight.toLocaleString('en-US')} lb printed commodity net · ${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'}`,
      ticketCount: tickets.length, netWeightLb: weight, ticket: tickets.join(', '), expectedValue: amount, realizedValue: amount,
      paymentReference: source.paymentReference, status: 'Paid' as const, owner: source.owner,
      note: `Daily allocation of statement ${source.id}. Date is the printed yard ticket date. Shared payment received ${statement.payment_received_date}; this entry is only its $${amount.toFixed(2)} allocation. Original statement and photos remain in the source evidence folder.\n` + lines.map(row => `${row.ticket} | ${row.commodity} | ${row.printed_net_lb} lb | $${row.amount_usd}`).join('\n'),
      updatedAt: stamp,
    };
    return { ...value, version: version(value) };
  });
}
