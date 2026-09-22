export type CustomerSelection = { query: string; key: string };
export type CustomerMatch = { key: string; name: string; phone: string; email: string; company: string; billingAddress: string; serviceAddress: string; appointmentType: string };
export type CustomerDetails = { firstName: string; lastName: string; phone: string; email: string; business: boolean; company: string; billingAddress: string; billingZip: string; billingEmail: string; serviceAddress: string; serviceZip: string; serviceContactName: string; serviceContactPhone: string };
export type CustomerLookupResult = { matches: CustomerMatch[]; hasMore: boolean; checkedAt: string; customer?: CustomerDetails };
export function customerSearchFields(query: string) {
  const value = query.replace(/\s+/g, ' ').trim();
  if (value.length < 2 || value.length > 160) throw new Error('Enter a name, email, or phone number (2–160 characters).');
  if (value.includes('@')) return { email: value };
  if (/^[+\d\s().-]+$/.test(value)) {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 11) throw new Error('Enter at least seven phone digits.');
    return { phone: digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits };
  }
  const [first, ...rest] = value.split(' ');
  return rest.length ? { firstName: first, lastName: rest.join(' ') } : { lastName: first };
}
export function normalizeCustomerSelection(value: unknown): CustomerSelection | undefined {
  if (value == null) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.query !== 'string' || typeof input.key !== 'string' || !/^[a-f0-9]{64}$/.test(input.key)) throw new Error('Search for and select the customer again.');
  customerSearchFields(input.query);
  return { query: input.query.trim(), key: input.key };
}
