import { HOUSE_NUMBER_PATTERN } from './service-house-number';

// A display-only interpretation of a trailing road shorthand. Do not treat
// this as equivalent postal text or use it for exact-property verification.
// Require a complete comma-separated locality/ZIP; prefix CR 123 stays intact.
const circleShorthand = new RegExp(`^(${HOUSE_NUMBER_PATTERN}\\s+(?:[A-Z][A-Z.'’-]*\\s+){1,10})Cr\\.?(,\\s*[A-Z][A-Z .'-]*,?\\s+(?:(?:LA|LOUISIANA)[,\\s]+)?\\d{5}(?:-\\d{4})?\\s*)$`, 'i');
export function approximateMapAddressQuery(address:string) {
  return address.replace(circleShorthand,'$1Cir$2');
}
