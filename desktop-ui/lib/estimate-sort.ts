import type { EstimateRow } from './estimate-contract';

export const estimateSortOptions = [
  ['priority', 'Follow-up priority'],
  ['date_desc', 'Estimate date · newest first'],
  ['date_asc', 'Estimate date · oldest first'],
  ['quote_desc', 'Quote · highest first'],
  ['quote_asc', 'Quote · lowest first'],
  ['customer_asc', 'Customer · A–Z'],
  ['customer_desc', 'Customer · Z–A'],
  ['next_asc', 'Next follow-up · earliest first'],
  ['next_desc', 'Next follow-up · latest first'],
] as const;
export type EstimateSort = typeof estimateSortOptions[number][0];
export const parseEstimateSort = (value: string | null): EstimateSort => estimateSortOptions.find(([key]) => key === value)?.[0] || 'priority';

export function compareEstimates(a: EstimateRow, b: EstimateRow, sort: EstimateSort): number {
  const fallback = b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
  if (sort === 'priority') return Number(b.overdue) - Number(a.overdue) || Number(b.dueToday) - Number(a.dueToday) || fallback;
  const descending = sort.endsWith('_desc');
  const left = sort.startsWith('quote') ? a.quote : sort.startsWith('customer') ? a.customer.trim() : sort.startsWith('next') ? a.followup.nextFollowup : a.date;
  const right = sort.startsWith('quote') ? b.quote : sort.startsWith('customer') ? b.customer.trim() : sort.startsWith('next') ? b.followup.nextFollowup : b.date;
  // Missing values stay last in both directions; a zero-dollar quote is known.
  const leftMissing = left == null || left === '';
  const rightMissing = right == null || right === '';
  if (leftMissing || rightMissing) return Number(leftMissing) - Number(rightMissing) || fallback;
  const order = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'en', { sensitivity: 'base', numeric: true });
  return (descending ? -order : order) || fallback;
}
