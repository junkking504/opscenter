import { readHistorySources, relatedHistory, type HistorySource } from './customer-history';
import { chicagoDateKey } from './report-dates';
import type { CustomerAccount, CustomerDirectory, CustomerSummary } from '../desktop-ui/lib/customer-history-contract';

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const newest = (a: HistorySource, b: HistorySource) => b.date.localeCompare(a.date) || b.order - a.order || a.id.localeCompare(b.id);
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const summary = (row: HistorySource, count: number): CustomerSummary => ({ id: row.id, name: row.customer || 'Name unavailable', phone: row.phone, email: row.email, address: row.address, appointments: count, latestDate: row.date });

// Directory grouping is intentionally narrower than account history matching.
// No transitive contact joins, name-only joins, or persisted account merges.
export function customerDirectory(rows: HistorySource[], query = '', offset = 0, limit = 50): Omit<CustomerDirectory, 'coverage'> {
  const groups = new Map<string, HistorySource[]>();
  for (const row of rows) {
    const name = normalize(row.customer);
    const contact = row.phone ? `phone:${row.phone}` : row.email ? `email:${row.email}` : '';
    const key = name.length >= 3 && contact ? `${name}|${contact}` : `appointment:${row.id}`;
    const group = groups.get(key) || []; group.push(row); groups.set(key, group);
  }
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const digits = query.replace(/\D/g, '');
  const matches = [...groups.values()].filter(group => !words.length || group.some(row => {
    const haystack = [row.customer, row.phone, row.email, row.address, row.jk].join(' ').toLowerCase();
    return words.every(word => haystack.includes(word)) || digits.length >= 7 && row.phone.includes(digits.replace(/^1(?=\d{10}$)/, ''));
  })).map(group => { group.sort(newest); return summary(group[0], group.length); }).sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { customers: matches.slice(offset, offset + limit), total: matches.length, offset };
}

export function customerAccount(rows: HistorySource[], id: string, offset = 0, limit = 50): Omit<CustomerAccount, 'coverage'> | null {
  const anchor = rows.find(row => row.id === id);
  if (!anchor) return null;
  const related = relatedHistory(rows, id) || [];
  const ids = new Set([id, ...related.map(row => row.id)]);
  const members = rows.filter(row => ids.has(row.id)).sort(newest);
  // Use direct name/contact matches for account contacts; an explicitly linked
  // appointment with a different contact remains in history, not the profile.
  const contacts = members.filter(row => normalize(row.customer) === normalize(anchor.customer) && (row.id === id || Boolean(anchor.phone && row.phone === anchor.phone || anchor.email && row.email === anchor.email)));
  const latest = contacts[0] || anchor;
  const { phone: _phone, email: _email, estimateId: _estimateId, order: _order, ...current } = anchor;
  const records = [{ ...current, relationship: 'contact' as const }, ...related].sort((a,b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { customer: { ...summary(latest, records.length), id }, phones: unique(contacts.map(row => row.phone)), emails: unique(contacts.map(row => row.email)), addresses: unique(contacts.map(row => row.address)), records: records.slice(offset, offset + limit), total: records.length, offset };
}

export async function readCustomers(query: string, offset: number, id?: string, dataDirectory?: string) {
  const { rows, coverage } = await readHistorySources(chicagoDateKey(), dataDirectory);
  const result = id ? customerAccount(rows, id, offset) : customerDirectory(rows, query, offset);
  return result ? { ...result, coverage } : null;
}
