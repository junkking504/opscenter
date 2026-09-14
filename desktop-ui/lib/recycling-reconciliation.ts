import type { RecyclingRecord } from './commercial-contract';
import type { RecyclingReceiptLine } from './recycling-receipts';

export const recyclingYardKey = (yard: string) => yard.toLowerCase().replace(/\b(?:ltd|itd|limited|llc|inc)\b/g, '').replace(/[^a-z0-9]/g, '');
export function recyclingTicketGroups(rows: RecyclingReceiptLine[]) {
  const keys = [...new Set(rows.map(row => `${row.date}|${row.ticket.trim()}`))];
  return keys.map(key => {
    const lines = rows.filter(row => `${row.date}|${row.ticket.trim()}` === key);
    const commodities = lines.filter(row => !/weight deduction/i.test(row.material));
    return { date: lines[0].date, ticket: lines[0].ticket.trim(), lines,
      weightLb: !commodities.length || commodities.some(row => row.weightLb == null) ? null : commodities.reduce((sum, row) => sum + row.weightLb!, 0),
      value: lines.some(row => row.amount == null) ? null : lines.reduce((sum, row) => sum + Math.round(row.amount! * 100), 0) / 100 };
  });
}

/** Ticket + date + yard identifies a delivery; the statement never overwrites its source weight. */
export function matchRecyclingTickets(records: RecyclingRecord[], yard: string, rows: RecyclingReceiptLine[], kind: 'delivery' | 'statement' = 'statement') {
  return recyclingTicketGroups(rows).map(group => {
    const candidates = records.filter(record => record.date === group.date && recyclingYardKey(record.yard) === recyclingYardKey(yard) && record.ticket.split(/[,;\s]+/).includes(group.ticket));
    const record = candidates.length === 1 ? candidates[0] : undefined;
    const issue = candidates.length > 1 ? 'More than one saved record has this ticket.'
      : kind === 'delivery' && record ? (record.deliveryReceiptId || !record.statementLines || record.ticket.trim() !== group.ticket ? 'Ticket is already recorded; review the existing entry.' : '')
      : record && (!record.deliveryReceiptId || record.ticket.trim() !== group.ticket) ? 'Ticket is already recorded; review the existing entry.'
      : record?.statementId ? 'Ticket is already matched to a cash-out statement.'
      : record?.status === 'Paid' ? 'Ticket has a recorded payment; review it before cash-out matching.' : '';
    const weightIssue = record?.netWeightLb == null || group.weightLb == null ? 'Weight comparison incomplete'
      : Math.abs(record.netWeightLb - group.weightLb) > .005 ? `Weight mismatch: delivered ${record.netWeightLb.toLocaleString('en-US')} lb; statement ${group.weightLb.toLocaleString('en-US')} lb` : '';
    return { ...group, record, issue, weightIssue: record ? weightIssue : '' };
  });
}

export function recyclingMatchStatus(record: RecyclingRecord) {
  if (!record.deliveryReceiptId) return record.statementId ? 'Statement only · delivery ticket not linked' : 'Delivery evidence not linked';
  if (!record.statementId) return 'Awaiting monthly cash-out';
  if (record.netWeightLb == null || record.statementWeightLb == null) return 'Matched ticket · weight needs review';
  if (Math.abs(record.netWeightLb - record.statementWeightLb) > .005) return `Weight mismatch · delivered ${record.netWeightLb.toLocaleString('en-US')} lb / statement ${record.statementWeightLb.toLocaleString('en-US')} lb`;
  return record.status === 'Paid' ? 'Matched and paid' : 'Matched · payment pending';
}
