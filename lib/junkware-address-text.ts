// JunkWare's flattened Schedule contact cell can append action labels to the
// postal address. Remove only a complete, recognized action-only suffix after
// a ZIP. Never truncate arbitrary notes, units or a second candidate address.
export function cleanJunkwareAddressText(address: string): string {
  return address.replace(/\s+/g, ' ').trim().replace(
    /(\b\d{5}(?:-\d{4})?(?:,?\s+(?:USA|United States))?)(?:\s+(?:(?:(?:CCR|Driver|Office)\s+)?Follow[ -]?up|SMS|More Details)\.?)+$/i,
    '$1',
  );
}
