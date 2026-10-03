import { fullFieldStreetAddress, serviceStreetCandidates } from './appointment-partner';
import { cleanJunkwareAddressText } from './junkware-address-text';
import { cleanServiceQuery, normalizeServiceAddress } from './service-address-format';
import { verifyAddressResult, type AddressVerification } from './desktop-address-verification';
import { geocodioAddressJson } from './geocodio-free-transport';

export function geocodioAddressQuery(address: string): string | null {
  address = cleanJunkwareAddressText(address);
  // Do not discard an explicit building identifier and silently select another
  // building on a campus. Apartment entrances remain unverified.
  if (serviceStreetCandidates(address).length !== 1 || /\b(?:BLDG|BUILDING)\b/i.test(address)) return null;
  const query = cleanServiceQuery(fullFieldStreetAddress(address));
  if (!/\b\d{5}(?:-\d{4})?$/.test(query)) return null;
  return /\b(?:LA|LOUISIANA)[,\s]+\d{5}/i.test(query) ? query : query.replace(/[,\s]+(\d{5}(?:-\d{4})?)$/, ', LA $1');
}

type Row = {
  address_components?: Record<string, string>;
  location?: { lat: number; lng: number };
  accuracy?: number;
  accuracy_type?: string;
  match_type?: string | null;
};
export function verifyGeocodioAddress(address: string, payload: unknown): AddressVerification {
  const unavailable = { location: null, reason: 'No Exact Geocodio Premises Match' };
  if (!geocodioAddressQuery(address)) return unavailable;
  const rows = (payload as { results?: Row[] } | null)?.results;
  // Never select the first result or remove competing candidates to create
  // apparent certainty. A high score alone is not premise-level evidence.
  if (!Array.isArray(rows) || !rows.length) return unavailable;
  if (rows.length !== 1) return { location: null, reason: 'Multiple Geocodio Address Matches' };
  const row = rows[0], a = row?.address_components;
  if (!a || Object.values(a).some(value => typeof value !== 'string')
    || row.accuracy !== 1 || row.accuracy_type !== 'rooftop'
    || ![null, undefined, 'building_centroid', 'parcel_centroid'].includes(row.match_type)
    || a.unit_number || a.unit_type) return unavailable;
  const c = (type: string, value = '') => ({ types: [type], long_name: value, short_name: value });
  const checked = verifyAddressResult(address, { status: 'OK', results: [{
    address_components: [c('street_number', a.number), c('route', a.formatted_street),
      c('locality', a.city), c('postal_code', a.postal_code),
      c('administrative_area_level_1', a.state_province), c('country', a.country)],
    geometry: { location: row.location, location_type: 'ROOFTOP' },
  }] });
  if (!checked.location) return unavailable;
  const precision = row.match_type === 'parcel_centroid' ? 'Parcel Point' : row.match_type === 'building_centroid' ? 'Building Point' : 'Premises Point';
  return { ...checked, reason: `Exact Geocodio ${precision} Verified; Unit Entrance Not Located`,
    matchedAddress: `${a.number} ${a.formatted_street}, ${a.city}, LA ${a.postal_code}`,
    source: 'Geocodio', sourceUrl: 'https://api.geocod.io/v2/geocode' };
}

export async function verifyGeocodioAddressFallback(address: string, budgetMs = 8_000): Promise<AddressVerification | null> {
  const query = geocodioAddressQuery(address);
  if (!query) return null;
  const response = await geocodioAddressJson(query, normalizeServiceAddress(query), budgetMs);
  if (!response) return null; // Disabled/unconfigured: preserve existing provider behavior.
  if (response.reason) return { location: null, reason: response.reason, retryAfterMs: response.retryAfterMs };
  return verifyGeocodioAddress(address, response.payload);
}
