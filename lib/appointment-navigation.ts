import {serviceAddressForGeocoding} from './appointment-partner';

/** Resolve the original service address in Maps, independently of our map pin. */
export function appointmentDirectionsHref(address:string):string|null {
  const query=serviceAddressForGeocoding(address).trim();
  if(!query || /^(?:—|-|unknown|unavailable)$/i.test(query))return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}
