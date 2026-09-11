import crypto from 'node:crypto';
import { readRecyclingData, writeRecyclingData, recyclingVersion } from './recycling-receipt-store';
import { executeCommercialOperation, validCommercialDate, CommercialActionError } from './desktop-marketing';
import type { CommercialOperation, RecyclingRecord } from '../desktop-ui/lib/commercial-contract';
import type { RecyclingReceiptLine } from '../desktop-ui/lib/recycling-receipts';
import type { InteractiveOpsRole } from './ops-roles';
const fail = (message: string): never => { throw new CommercialActionError(message); };
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000 && Math.abs(value*100-Math.round(value*100))<.0001;
export function recordReviewedRecyclingReceipt(operation: CommercialOperation, actor: { email: string; role: InteractiveOpsRole }) {
  const values = operation.values;
  if (values.reviewed !== true || typeof values.paid !== 'boolean') fail('Confirm all pages and extracted lines have been checked.');
  if (typeof values.yard !== 'string' || !values.yard.trim() || values.yard.length > 500) fail('Enter the recycling yard.');
  if (!amount(values.total)) fail('Enter the complete receipt total.');
  if (!Array.isArray(values.rows) || !values.rows.length || values.rows.length > 200) fail('Enter 1–200 receipt lines.');
  const rows = values.rows as RecyclingReceiptLine[];
  if (rows.some(row => !row || !validCommercialDate(row.date) || typeof row.ticket !== 'string' || !row.ticket.trim() || row.ticket.length > 200 || typeof row.material !== 'string' || !row.material.trim() || row.material.length > 500 || !amount(row.amount) || (row.weightLb != null && !amount(row.weightLb)))) fail('Each line needs a valid date, ticket, material and amount; check any weights entered.');
  if (rows.some(row => /weight deduction/i.test(row.material) && row.amount !== 0)) fail('A weight deduction with a nonzero amount needs correction before recording.');
  const totalCents = rows.reduce((sum, row) => sum+Math.round(row.amount!*100),0);
  if (totalCents !== Math.round(Number(values.total)*100)) fail('Line amounts must equal the receipt total.');
  if (values.paid && (typeof values.paymentDate !== 'string' || !validCommercialDate(values.paymentDate) || typeof values.paymentReference !== 'string' || !values.paymentReference.trim() || values.paymentReference.length > 500)) fail('For received payments, enter the actual received date and payment reference.');
  return executeCommercialOperation(operation, actor, () => {
    const store = readRecyclingData(); const draft = store.receiptDrafts?.find(draft => draft.id === operation.recordId);
    if (!draft || draft.status !== 'review') fail('Receipt already recorded or unavailable.');
    for (const row of rows) if (store.records.some(record => record.date === row.date && record.ticket.split(/[,;\s]+/).includes(row.ticket.trim()))) fail(`Ticket ${row.ticket} on ${row.date} is already recorded. No runs added.`);
    return draft!.version;
  }, () => {
    const store = readRecyclingData(); const draft = store.receiptDrafts?.find(draft => draft.id === operation.recordId);
    if (!draft || draft.status !== 'review') fail('Receipt already recorded or unavailable.');
    for (const row of rows) if (store.records.some(record => record.date === row.date && record.ticket.split(/[,;\s]+/).includes(row.ticket.trim()))) fail(`Ticket ${row.ticket} on ${row.date} is already recorded. No runs added.`);
    const now = new Date().toISOString();
    const records: RecyclingRecord[] = [...new Set(rows.map(row => row.date))].sort().map(date => {
      const lines = rows.filter(row => row.date === date); const tickets = [...new Set(lines.map(row => row.ticket.trim()))];
      const commodities = lines.filter(row => !/weight deduction/i.test(row.material));
      const weight = commodities.some(row => row.weightLb == null) ? null : commodities.reduce((sum, row) => sum+row.weightLb!,0);
      const value = lines.reduce((sum,row) => sum+Math.round(row.amount!*100),0)/100;
      const record = { id: crypto.randomUUID(), date, dateBasis: 'yard_ticket' as const, statementId: draft!.id, material: 'Scrap metal · receipt breakdown',
        sourceJob: 'OpsBot recycling receipt', yard: String(values.yard).trim(), quantity: weight == null ? 'Weight not fully recorded' : `${weight.toLocaleString('en-US')} lb printed commodity net`,
        ticketCount: tickets.length, ticket: tickets.join(', '), expectedValue: value, realizedValue: values.paid ? value : null,
        paymentDate: values.paid ? String(values.paymentDate) : '', paymentReference: values.paid ? String(values.paymentReference) : '',
        status: values.paid ? 'Paid' as const : 'Submitted' as const, owner: actor.email,
        note: lines.map(row => `${row.ticket} | ${row.material} | ${row.weightLb ?? 'Unknown'} lb | $${row.amount!.toFixed(2)}`).join('\n'), updatedAt: now };
      return { ...record, version: recyclingVersion(record) };
    });
    store.records.push(...records); draft!.status = 'recorded'; draft!.rows = rows; draft!.total = Number(values.total); draft!.yard = String(values.yard); draft!.recordIds = records.map(row => row.id); draft!.updatedAt = now; draft!.version = recyclingVersion({ ...draft, version: undefined });
    writeRecyclingData(store);
    const actual = readRecyclingData(); return records.every(row => actual.records.some(saved => saved.id === row.id && saved.version === row.version));
  });
}
