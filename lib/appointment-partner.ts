type PartnerSource = { address: string; customerName: string };

// Partner identity belongs to the source business label, never an item brand
// or an incidental mention in free-form appointment notes.
const partners = [
  { name: 'Amazon', short: 'AMZ', pattern: /^amazon(?:\s+mattress\s+removal)?\b/i },
  { name: 'Home Sweet Home', short: 'HSH', pattern: /^home\s*sweet\s*home\b/i },
  { name: 'DMTransportation', short: 'DMT', pattern: /^d\s*m\s*transportation\b/i },
] as const;

export function appointmentPartner(job: PartnerSource) {
  const business = job.address.split(/\b\d+[A-Z]?\b/i)[0].trim();
  const partner = partners.find(partner => [business, job.customerName.trim()].some(label => partner.pattern.test(label)));
  return partner ? { name: partner.name, short: partner.short } : null;
}

// Only remove an alphabetic business prefix before a recognizable street.
// Keep the entire source street, unit, city, state and ZIP for verification.
export function serviceAddressForGeocoding(address: string): string {
  const match = address.match(/^[^\d]+?\s+(\d+[A-Z]?\s+(?:(?!\b\d+\b).)+?\b(?:st(?:reet)?|rd|road|ave(?:nue)?|dr(?:ive)?|ln|lane|ct|court|blvd|boulevard|hwy|highway|pl(?:ace)?|pkwy|parkway|ter(?:race)?|cir(?:cle)?|trl|trail|way)\b.*\b\d{5}(?:-\d{4})?\s*)$/i);
  return match ? match[1].trim() : address;
}
