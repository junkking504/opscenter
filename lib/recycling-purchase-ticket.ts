import type { RecyclingReceiptLine } from '../desktop-ui/lib/recycling-receipts';

/** Conservative support for a single-material EMR weight ticket. No price or payment is inferred. */
export function parseRecyclingPurchaseTicket(text: string): RecyclingReceiptLine[] {
  if (!/Purchase Ticket/i.test(text) || /payment breakdown/i.test(text)) return [];
  const tickets = [...text.matchAll(/Ticket No\s*\/\s*Depot\s*:\s*(\d{5,12})\b/gi)];
  const date = text.match(/Date\s*\/\s*Time\s*:?\s*(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})\b/i);
  const weights = [...text.matchAll(/\b([\d,]+(?:\.\d+)?)\s+LB\b/gi)];
  if (tickets.length !== 1 || !date || weights.length !== 1 || (text.match(/FRAG FEED/gi) || []).length !== 1) return [];
  const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(date[2].toLowerCase()) + 1;
  const day = `${date[3].length === 2 ? '20' : ''}${date[3]}-${String(month).padStart(2, '0')}-${date[1].padStart(2, '0')}`;
  const weightLb = Number(weights[0][1].replaceAll(',', ''));
  if (!month || !Number.isFinite(Date.parse(day)) || new Date(`${day}T12:00:00Z`).toISOString().slice(0,10) !== day || weightLb <= 0 || weightLb > 1000000) return [];
  return [{ date: day, ticket: tickets[0][1], material: 'FRAG FEED', weightLb, amount: null }];
}
