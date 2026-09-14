import crypto from 'node:crypto';
import { readRecyclingData, writeRecyclingData, recyclingVersion } from './recycling-receipt-store';
import { executeCommercialOperation, validCommercialDate, CommercialActionError } from './desktop-marketing';
import type { CommercialOperation, RecyclingRecord } from '../desktop-ui/lib/commercial-contract';
import type { RecyclingReceiptLine } from '../desktop-ui/lib/recycling-receipts';
import { matchRecyclingTickets } from '../desktop-ui/lib/recycling-reconciliation';
import type { InteractiveOpsRole } from './ops-roles';
const fail = (message: string): never => { throw new CommercialActionError(message); };
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000 && Math.abs(value*100-Math.round(value*100))<.0001;
export function recordReviewedRecyclingReceipt(operation: CommercialOperation, actor: { email: string; role: InteractiveOpsRole }) {
  const values = operation.values;
  const delivery = values.kind === 'delivery';
  if (values.kind !== undefined && !['delivery', 'statement'].includes(String(values.kind))) fail('Select a delivery ticket or cash-out statement.');
  if (values.reviewed !== true || typeof values.paid !== 'boolean') fail('Confirm all pages and extracted lines have been checked.');
  if (typeof values.yard !== 'string' || !values.yard.trim() || values.yard.length > 500) fail('Enter the recycling yard.');
  if (delivery ? values.total !== null || values.paid : !amount(values.total)) fail(delivery ? 'Delivery tickets cannot record income or payment. Use the monthly cash-out.' : 'Enter the complete receipt total.');
  if (!Array.isArray(values.rows) || !values.rows.length || values.rows.length > 200) fail('Enter 1–200 receipt lines.');
  const rows = values.rows as RecyclingReceiptLine[];
  if (rows.some(row => !row || !validCommercialDate(row.date) || typeof row.ticket !== 'string' || !row.ticket.trim() || row.ticket.length > 200 || /[,;\s]/.test(row.ticket.trim()) || typeof row.material !== 'string' || !row.material.trim() || row.material.length > 500 || (delivery ? row.amount !== null || !amount(row.weightLb) : !amount(row.amount) || (row.weightLb != null && !amount(row.weightLb))))) fail('Each line needs a valid date, ticket, material and amount or delivery weight.');
  if (delivery && new Set(rows.map(row => JSON.stringify([row.date, row.ticket.trim(), row.material.trim().toLowerCase(), row.weightLb]))).size !== rows.length) fail('Duplicate delivery lines: check whether the same ticket photo was sent twice.');
  if (rows.some(row => /weight deduction/i.test(row.material) && !delivery && row.amount !== 0)) fail('A weight deduction with a nonzero amount needs correction before recording.');
  const totalCents = rows.reduce((sum, row) => sum+Math.round((row.amount ?? 0)*100),0);
  if (!delivery && totalCents !== Math.round(Number(values.total)*100)) fail('Line amounts must equal the receipt total.');
  if (values.paid && (typeof values.paymentDate !== 'string' || !validCommercialDate(values.paymentDate) || typeof values.paymentReference !== 'string' || !values.paymentReference.trim() || values.paymentReference.length > 500)) fail('For received payments, enter the actual received date and payment reference.');
  const preflight = () => {
    const store = readRecyclingData(); const draft = store.receiptDrafts?.find(draft => draft.id === operation.recordId);
    if (!draft || draft.status !== 'review') fail('Receipt already recorded or unavailable.');
    const matches = matchRecyclingTickets(store.records, String(values.yard), rows, delivery ? 'delivery' : 'statement');
    for (const match of matches) {
      if (match.issue) fail(`Ticket ${match.ticket}: ${match.issue || 'already recorded as a delivery.'}`);
      if (match.record) {
        const versions = values.recordVersions as Record<string, string> | undefined;
        if (versions?.[match.record.id] !== match.record.version) fail(`Ticket ${match.ticket} changed. Refresh and review its current match.`);
      }
    }
    return { store, draft: draft!, matches };
  };
  return executeCommercialOperation(operation, actor, () => preflight().draft.version, () => {
    const { store, draft, matches } = preflight();
    const now = new Date().toISOString();
    const records: RecyclingRecord[] = matches.map(match => {
      const existing = match.record;
      const { date, ticket, lines, weightLb: weight, value } = match;
      const record: Omit<RecyclingRecord, 'version'> = { ...existing,
        id: existing?.id || crypto.randomUUID(), date, dateBasis: 'yard_ticket',
        ...(delivery ? { deliveryReceiptId: draft.id, deliveryLines: lines } : { statementId: draft.id, statementLines: lines, statementWeightLb: weight }),
        material: existing?.material || [...new Set(lines.filter(row => !/weight deduction/i.test(row.material)).map(row => row.material))].join(', '),
        sourceJob: existing?.sourceJob || (delivery ? 'OpsBot delivery ticket' : 'OpsBot cash-out statement'), yard: String(values.yard).trim(),
        quantity: (!delivery && existing?.quantity) || (weight == null ? 'Weight not fully recorded' : `${weight.toLocaleString('en-US')} lb net`),
        netWeightLb: delivery ? weight ?? undefined : existing?.netWeightLb ?? weight ?? undefined,
        ticketCount: 1, ticket, expectedValue: delivery && existing ? existing.expectedValue : value, realizedValue: delivery && existing ? existing.realizedValue : values.paid ? value : null,
        paymentDate: delivery && existing ? existing.paymentDate : values.paid ? String(values.paymentDate) : '', paymentReference: delivery && existing ? existing.paymentReference : values.paid ? String(values.paymentReference) : '',
        status: delivery && existing ? existing.status : values.paid ? 'Paid' : 'Submitted', owner: existing?.owner || actor.email,
        note: existing?.note || lines.map(row => `${row.ticket} | ${row.material} | ${row.weightLb ?? 'Unknown'} lb | ${row.amount == null ? 'Awaiting monthly cash-out' : '$' + row.amount.toFixed(2)}`).join('\n'), updatedAt: now };
      return { ...record, version: recyclingVersion(record) };
    });
    const ids = new Set(records.map(record => record.id));
    store.records = store.records.filter(record => !ids.has(record.id)).concat(records);
    draft.status = 'recorded'; draft.kind = delivery ? 'delivery' : 'statement'; draft.rows = rows; draft.total = delivery ? null : Number(values.total); draft.yard = String(values.yard); draft.recordIds = records.map(row => row.id); draft.updatedAt = now; draft.version = recyclingVersion({ ...draft, version: undefined });
    writeRecyclingData(store);
    const actual = readRecyclingData(); return records.every(row => actual.records.some(saved => saved.id === row.id && saved.version === row.version));
  });
}
