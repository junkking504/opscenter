// Keep ranges, fractions and suffixes intact. Never search inside a house
// identifier for a smaller number that happens to match a provider result.
export const HOUSE_NUMBER_PATTERN = String.raw`\d+[A-Z]{0,3}(?:\s+\d+\/\d+|[¼½¾]|\s*[-–]\s*\d+[A-Z]{0,3})?`;
const houseAndStreet = new RegExp(`^(${HOUSE_NUMBER_PATTERN})\\s+(.+)$`, 'i');
export function serviceHouseAndStreet(value: string): {house: string; street: string} | null {
  const match = value.trim().match(houseAndStreet);
  return match ? {house: match[1], street: match[2]} : null;
}
export function normalizeHouseNumber(value: string): string {
  return value.toUpperCase().replace(/[¼½¾]/g, fraction => ({'¼':' 1/4','½':' 1/2','¾':' 3/4'}[fraction]!))
    .replace(/\s*[-–]\s*/g, '-').replace(/\s+/g, ' ').trim();
}

// A business prefix may precede a street whose road type was omitted. Use the
// first complete number only; a numeric business label cannot be skipped to
// manufacture a later match when the street scanner found no full expression.
export function firstHouseAndStreet(value: string): {house: string; street: string} | null {
  const first = new RegExp(`(?<![A-Z0-9/#-])${HOUSE_NUMBER_PATTERN}\\s+`, 'i').exec(value);
  return first ? serviceHouseAndStreet(value.slice(first.index)) : null;
}
