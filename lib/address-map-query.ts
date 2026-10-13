import { HOUSE_NUMBER_PATTERN } from './service-house-number';

// A display-only interpretation of a trailing road shorthand. Do not treat
// this as equivalent postal text or use it for exact-property verification.
// Require a complete comma-separated locality/ZIP; prefix CR 123 stays intact.
const circleShorthand = new RegExp(`^(${HOUSE_NUMBER_PATTERN}\\s+(?:[A-Z][A-Z.'’-]*\\s+){1,10})Cr\\.?(,\\s*[A-Z][A-Z .'-]*,?\\s+(?:(?:LA|LOUISIANA)[,\\s]+)?\\d{5}(?:-\\d{4})?\\s*)$`, 'i');
export function approximateMapAddressQuery(address:string) {
  // A separated non-directional house letter may identify a unit/building.
  // Require a named road plus suffix; preserve N/S/E/W and single-letter roads.
  // This is display-only: exact verification still receives the source text.
  const display=address.replace(circleShorthand,'$1Cir$2').replace(/^(\d+)\s+([A-DF-MO-RT-VX-Z])\s+(?=[A-Z][A-Z.'’-]+(?:\s+[A-Z][A-Z.'’-]+){0,8}\s+(?:St(?:reet)?|Rd|Road|Ave(?:nue)?|Dr(?:ive)?|Ln|Lane|Blvd|Boulevard|Ct|Court|Cir(?:cle)?)\b)/i,'$1$2 ');
  return display;
}
