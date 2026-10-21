export const customerFields = {
  firstName: 'FirstNameTB', lastName: 'LastNameTB', phone: 'PhoneTB', secondaryPhone: 'Phone2TB',
  email: 'EmailTB', address: 'AppointmentAddressTB', zip: 'AppointmentZipTB',
} as const;
export type CustomerDetails = Record<keyof typeof customerFields, string>;
export type CustomerChange = {customer: CustomerDetails; expectedSourceVersion: string; protectedVersion: string};
export function parseCustomerChange(value: Record<string, unknown>): CustomerChange {
  const input = value.customer as Record<string, unknown>;
  if (!input || typeof input !== 'object' || !/^[a-f0-9]{64}$/.test(String(value.expectedSourceVersion)) || !/^[a-f0-9]{64}$/.test(String(value.protectedVersion))) throw new Error('Reload current customer information before saving.');
  const customer = {} as CustomerDetails;
  const limits = {firstName:45,lastName:45,phone:20,secondaryPhone:20,email:100,address:150,zip:7};
  for (const key of Object.keys(customerFields) as Array<keyof CustomerDetails>) {
    if (typeof input[key] !== 'string' || (input[key] as string).length > limits[key] || /[\r\n\x00-\x1f]/.test(input[key] as string)) throw new Error(`A valid ${key} is required.`);
    customer[key] = (input[key] as string).trim();
  }
  if (!customer.firstName || !customer.lastName || !customer.address || !/^\d{5}$/.test(customer.zip)) throw new Error('First name, last name, service address and a five-digit ZIP are required.');
  for (const phone of [customer.phone,customer.secondaryPhone]) if (phone && !/^(?:1)?\d{10}$/.test(phone.replace(/[^0-9]/g,''))) throw new Error('Enter a valid ten-digit phone number.');
  if (!customer.phone) throw new Error('A primary phone number is required.');
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new Error('Enter a valid email address or leave it blank.');
  return {customer,expectedSourceVersion:String(value.expectedSourceVersion),protectedVersion:String(value.protectedVersion)};
}
export function customerMatches(a: CustomerDetails,b: CustomerDetails) {
  return (Object.keys(customerFields) as Array<keyof CustomerDetails>).every(key => key==='phone' || key==='secondaryPhone' ? a[key].replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'')===b[key].replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'') : a[key].trim()===b[key].trim());
}
