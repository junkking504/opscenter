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

export function serviceStreetCandidates(address: string): number[] {
  // Scan the whole field. A number inside a business label or suite is not a
  // street number unless followed by a recognizable street expression.
  return [...address.matchAll(/\b\d+[A-Z]?\s+(?:[A-Z][A-Z.'’-]*\s+){0,8}?(?:st(?:reet)?|rd|road|ave(?:nue)?|dr(?:ive)?|ln|lane|ct|court|blvd|boulevard|hwy|highway|pl(?:ace)?|pkwy|parkway|ter(?:race)?|cir(?:cle)?|trl|trail|way)\b/ig)].map(match=>match.index!);
}

// Public address links and duplicate checks retain their conservative handling
// of numeric business labels. Full-field verification examines candidates too.
export function serviceAddressForGeocoding(address: string): string {
  const candidates = serviceStreetCandidates(address);
  return candidates.length === 1 && !/\d/.test(address.slice(0,candidates[0])) && /\b\d{5}(?:-\d{4})?\s*$/.test(address) ? address.slice(candidates[0]).trim() : address;
}
export function fullFieldStreetAddress(address: string): string {
  const candidates = serviceStreetCandidates(address);
  return candidates.length === 1 && /\b\d{5}(?:-\d{4})?\s*$/.test(address) ? address.slice(candidates[0]).trim() : address;
}
