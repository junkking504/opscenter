/** Customer fields crews may correct. Billing, pricing and scheduling are excluded. */
export const CUSTOMER_FIELDS = {
  firstName: 'First name', lastName: 'Last name', phone: 'Phone number', alternatePhone: 'Alternate phone', email: 'Email',
  serviceAddress: 'Street address / unit', serviceZip: 'ZIP code', serviceContactName: 'On-site contact', serviceContactPhone: 'On-site contact phone',
} as const;
export type CustomerFields = Record<keyof typeof CUSTOMER_FIELDS, string>;
export type CustomerSource = { appointmentId: string; fields: CustomerFields; sourceVersion: string; protectedVersion: string; status: string; truck: string; date: string; city: string; state: string };
export function normalizeCustomerFields(input: unknown): CustomerFields {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Enter the customer details.');
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some(key => !Object.hasOwn(CUSTOMER_FIELDS, key))) throw new Error('Only customer contact and service address corrections are allowed.');
  const result = {} as CustomerFields;
  for (const key of Object.keys(CUSTOMER_FIELDS) as Array<keyof CustomerFields>) {
    if (typeof row[key] !== 'string' || /[\x00-\x1f\x7f]/.test(row[key] as string)) throw new Error(`Enter a valid ${CUSTOMER_FIELDS[key].toLowerCase()}.`);
    const value = (row[key] as string).trim().replace(/\s+/g, ' ');
    if (value.length > (key === 'serviceAddress' ? 250 : 160)) throw new Error(`${CUSTOMER_FIELDS[key]} is too long.`);
    result[key] = value;
  }
  if (!result.firstName || !result.lastName || !result.serviceAddress) throw new Error('First name, last name and service address are required.');
  if (!/^\d{5}(?:-\d{4})?$/.test(result.serviceZip)) throw new Error('Enter a five-digit ZIP code, optionally followed by four digits.');
  for (const key of ['phone', 'alternatePhone', 'serviceContactPhone'] as const) {
    const digits = result[key].replace(/\D/g, '');
    if ((!digits && key === 'phone') || (result[key] && (!/^[+\d\s().-]+$/.test(result[key]) || digits.length < 10 || digits.length > 15))) throw new Error(`Enter a valid ${CUSTOMER_FIELDS[key].toLowerCase()}.`);
    // Preserve unchanged source formatting; read-back compares phone digits.
  }
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error('Enter a valid email address or leave it blank.');
  return result;
}
export function customerFieldsMatch(a: CustomerFields, b: CustomerFields): boolean {
  return (Object.keys(CUSTOMER_FIELDS) as Array<keyof CustomerFields>).every(key => {
    const clean = (value: string) => /Phone$|^phone$/.test(key) ? value.replace(/\D/g, '') : value.trim().replace(/\s+/g, ' ');
    return clean(a[key]) === clean(b[key]);
  });
}
export function verifyCustomerCorrection(source: CustomerSource, expected: CustomerFields, protectedVersion: string) {
  if (source.status !== '1' || source.protectedVersion !== protectedVersion || !customerFieldsMatch(source.fields, expected)) throw new Error('JunkWare has not verified all customer corrections. Check the saved result before another change.');
}

export type SavedCustomerDetails = Pick<CustomerSource,'fields'|'city'|'state'>;
