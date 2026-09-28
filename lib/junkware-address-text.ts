// JunkWare's flattened Schedule contact cell can append action labels to the
// postal address. Remove only a complete, recognized action-only suffix after
// a ZIP. Never truncate arbitrary notes, units or a second candidate address.
export function cleanJunkwareAddressText(address: string): string {
  return address.replace(/\s+/g, ' ').trim().replace(repeatedStreet, '$1').replace(abbreviatedLoop, '$1Loop').replace(
    /(\b\d{5}(?:-\d{4})?(?:,?\s+(?:USA|United States))?)(?:\s+(?:(?:(?:CCR|Driver|Office)\s+)?Follow[ -]?up|SMS|More Details)\.?)+$/i,
    '$1',
  );
}

// Keep source/review/research identities stable. Only location lookup and
// returned-address validation use this equivalent postal representation.
export function cleanServiceAddressForVerification(address: string): string {
  const cleaned = cleanJunkwareAddressText(address);
  return cleaned.replace(repeatedLocality, (match, separator: string, city: string, firstZip: string | undefined, zip: string, offset: number) => {
    const prefix = cleaned.slice(0, offset) + separator;
    // Only a complete duplicate locality may disappear. A partial city suffix,
    // conflicting ZIP or intervening unit/address instruction stays visible to
    // the exact-address verifier. Keep the entire street and unit prefix.
    if ((firstZip && firstZip !== zip) || !localityBoundary.test(prefix)) return match;
    return `${separator}${city}, LA ${zip}`;
  });
}
import { HOUSE_NUMBER_PATTERN } from './service-house-number';

// A flattened business/contact cell can repeat the identical street before
// its single locality. Collapse only adjacent literal copies of a complete
// house/street expression; alternatives, units and different houses survive.
const repeatedStreet = new RegExp(`(?<![A-Z0-9/#-])(${HOUSE_NUMBER_PATTERN}\\s+(?:[A-Z][A-Z.'’-]*\\s+){0,10}?(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|boulevard|blvd|highway|hwy|place|pl|parkway|pkwy|pky|terrace|ter|circle|cir|trail|trl|loop|lp|way))\\.?\\s+\\1\\.?(?=[,\\s]|$)`, 'ig');
const abbreviatedLoop = new RegExp(`(?<![A-Z0-9/#-])(${HOUSE_NUMBER_PATTERN}\\s+(?:[A-Z][A-Z.'’-]*\\s+){1,10})LP\\b`, 'ig');

// JunkWare can append its separate city/ZIP to a street field that already
// includes city/state, with or without a first ZIP. Louisiana aliases are
// equivalent; the repeated city and any repeated ZIP must agree exactly.
const repeatedLocality = /([,\s]+)([A-Z][A-Z.'’-]*(?: +[A-Z][A-Z.'’-]*){0,5})[,\s]+(?:LA|LOUISIANA)(?:[,\s]+(\d{5}(?:-\d{4})?))?[,\s]+\2[,\s]+(?:(?:LA|LOUISIANA)[,\s]+)?(\d{5}(?:-\d{4})?)$/i;
const localityBoundary = /(?:,\s*|\b(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|boulevard|blvd|highway|hwy|place|pl|parkway|pkwy|pky|terrace|ter|circle|cir|trail|trl|loop|way)\.?(?:[,\s]+(?:(?:apt|apartment|suite|ste|unit|floor|fl|building|bldg)\.?\s*#?\s*|#\s*)[A-Z0-9]+(?:-[A-Z0-9]+)*)?[,\s]+)$/i;
