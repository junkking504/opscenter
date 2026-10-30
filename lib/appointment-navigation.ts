import {serviceAddressForGeocoding} from './appointment-partner';

/** Resolve the original service address in Maps, independently of our map pin. */
export function appointmentDirectionsHref(address:string):string|null {
  const query=serviceAddressForGeocoding(address).trim();
  if(!query || /^(?:—|-|unknown|unavailable)$/i.test(query))return null;
  return `https://maps.apple.com/directions?mode=driving&destination=${encodeURIComponent(query)}`;
}

/** Keep the caller's route order, including every intermediate stop. */
export function appleMapsRouteHref(addresses: string[]): string {
  const stops = addresses.map(address => address.trim()).filter(address => address && address !== '—');
  if (!stops.length) return '';
  if (stops.length === 1) return `https://maps.apple.com/search?query=${encodeURIComponent(stops[0])}`;
  const params = new URLSearchParams({mode: 'driving', source: stops[0], destination: stops[stops.length - 1]});
  stops.slice(1, -1).forEach(address => params.append('waypoint', address));
  return `https://maps.apple.com/directions?${params}`;
}
