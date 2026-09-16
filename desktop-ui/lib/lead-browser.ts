import type { Lead } from './commercial-contract';

export type LeadFilters = {
  query: string;
  territory: string;
  contact: '' | 'contacted' | 'uncontacted';
  queue: 'recover' | 'lost' | 'followup' | 'booked' | 'all';
  order: 'newest' | 'oldest' | 'value' | 'priority';
};
export const defaultLeadFilters: LeadFilters = { query: '', territory: '', contact: '', queue: 'recover', order: 'newest' };
export function inLeadQueue(lead: Lead, queue: LeadFilters['queue']) {
  if (queue === 'recover') return ['lost', 'needs_follow_up'].includes(lead.status);
  if (queue === 'followup') return lead.status === 'needs_follow_up';
  if (queue === 'booked') return ['booked', 'recovered'].includes(lead.status);
  return queue === 'all' || lead.status === 'lost';
}
export const leadStatusLabel = (status: string) => ({ needs_follow_up: 'Needs follow-up', lost: 'Lost', booked: 'Booked', recovered: 'Recovered', unqualified: 'Not qualified' }[status] || status);
export function leadPhoneHref(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits ? `tel:${digits.length === 10 ? '+1' : phone.trim().startsWith('+') ? '+' : ''}${digits}` : undefined;
}
export function browseLeads(leads: Lead[], filters: LeadFilters, requestedPage = 1, pageSize = 10) {
  const query = filters.query.trim().toLocaleLowerCase();
  const phoneQuery = /^[+\d\s().-]+$/.test(query) ? query.replace(/\D/g, '') : '';
  const matching = leads.filter(lead => {
    if (!inLeadQueue(lead, filters.queue)) return false;
    if (filters.territory && lead.territory !== filters.territory) return false;
    if (filters.contact && lead.contacted !== (filters.contact === 'contacted')) return false;
    return !query || [lead.customer, lead.phone, lead.intent, lead.territory, lead.source, lead.note, lead.reason.replaceAll('_', ' '), lead.jk].join(' ').toLocaleLowerCase().includes(query)
      || Boolean(phoneQuery && lead.phone.replace(/\D/g, '').includes(phoneQuery));
  }).sort((a, b) => {
    if (filters.order === 'value') {
      const delta = (b.quotedValue ?? -Infinity) - (a.quotedValue ?? -Infinity);
      if (delta) return delta;
    }
    if (filters.order === 'priority') {
      const rank = (lead: Lead) => lead.status === 'lost' ? 0 : lead.status === 'needs_follow_up' ? 1 : 2;
      const delta = rank(a) - rank(b);
      if (delta) return delta;
    }
    const delta = (Date.parse(b.calledAt) || 0) - (Date.parse(a.calledAt) || 0);
    return (filters.order === 'oldest' ? -delta : delta) || a.id.localeCompare(b.id);
  });
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.max(1, Math.min(pageCount, requestedPage));
  return { rows: matching.slice((page - 1) * pageSize, page * pageSize), total: matching.length, page, pageCount,
    start: matching.length ? (page - 1) * pageSize + 1 : 0, end: Math.min(page * pageSize, matching.length) };
}
