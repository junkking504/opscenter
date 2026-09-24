// JunkWare's flattened Schedule contact cell can append action labels to the
// postal address. Remove only a complete, recognized action-only suffix after
// a ZIP. Never truncate arbitrary notes, units or a second candidate address.
export function cleanJunkwareAddressText(address: string): string {
  return address.replace(/\s+/g, ' ').trim().replace(repeatedStreet, '$1').replace(abbreviatedLoop, '$1Loop').replace(
    /(\b\d{5}(?:-\d{4})?(?:,?\s+(?:USA|United States))?)(?:\s+(?:(?:(?:CCR|Driver|Office)\s+)?Follow[ -]?up|SMS|More Details)\.?)+$/i,
    '$1',
  );
}
import { HOUSE_NUMBER_PATTERN } from './service-house-number';

// A flattened business/contact cell can repeat the identical street before
// its single locality. Collapse only adjacent literal copies of a complete
// house/street expression; alternatives, units and different houses survive.
const repeatedStreet = new RegExp(`(?<![A-Z0-9/#-])(${HOUSE_NUMBER_PATTERN}\\s+(?:[A-Z][A-Z.'’-]*\\s+){0,10}?(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|boulevard|blvd|highway|hwy|place|pl|parkway|pkwy|pky|terrace|ter|circle|cir|trail|trl|loop|lp|way))\\.?\\s+\\1\\.?(?=[,\\s]|$)`, 'ig');
const abbreviatedLoop = new RegExp(`(?<![A-Z0-9/#-])(${HOUSE_NUMBER_PATTERN}\\s+(?:[A-Z][A-Z.'’-]*\\s+){1,10})LP\\b`, 'ig');
