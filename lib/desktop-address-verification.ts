import type { PlanningLocation } from './planning-geocodes';
import { serviceAddressForGeocoding } from './appointment-partner';

type Component = { long_name: string; short_name: string; types: string[] };
type Result = { partial_match?: boolean; address_components?: Component[]; geometry?: { location?: { lat: number; lng: number }; location_type?: string } };
type Payload = { status?: string; results?: Result[] };
export type AddressVerification = { location: PlanningLocation | null; reason: string };
const aliases: Record<string,string> = { STREET:'ST',ROAD:'RD',AVENUE:'AVE',DRIVE:'DR',LANE:'LN',COURT:'CT',BOULEVARD:'BLVD',HIGHWAY:'HWY',PLACE:'PL',PARKWAY:'PKWY',TERRACE:'TER',CIRCLE:'CIR',TRAIL:'TRL',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W' };
const normalize = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).map(word=>aliases[word]||word).join(' ');
const normalizeRouteName = (text: string) => normalize(text).replace(/\bS NORMAN FRANCIS PKWY\b/g, 'S NORMAN C FRANCIS PKWY');

function matchesStreet(requested: string, house: string, street: string, city: string) {
  const matched = normalizeRouteName(`${house} ${street}`);
  const input = normalizeRouteName(requested);
  if (input === matched || input.startsWith(`${matched} `)) return true;
  // JunkWare sometimes omits the road type ("824 Pontalba New Orleans").
  // Accept that omission only when the complete returned city follows the
  // complete street name. Never accept a street-name prefix or guessed suffix.
  const shortened = matched.replace(/ (ST|RD|AVE|DR|LN|CT|BLVD|HWY|PL|PKWY|TER|CIR|TRL)$/, '');
  if (shortened === matched || !city) return false;
  const addressThroughCity = `${shortened} ${normalize(city)}`;
  return input === addressThroughCity || input.startsWith(`${addressThroughCity} `);
}

// Match returned components, never a city centroid or a nearby street/house.
export function verifyAddressResult(address: string, payload: Payload): AddressVerification {
  if(payload.status!=='OK') return {location:null,reason:`Geocoding ${payload.status || 'Unavailable'}`};
  if(payload.results?.length!==1) return {location:null,reason:'Multiple Address Matches'};
  const result=payload.results[0];
  const component=(type:string)=>result.address_components?.find(value=>value.types.includes(type));
  const house=component('street_number')?.long_name;
  const street=component('route')?.long_name;
  const zip=component('postal_code')?.long_name;
  const expectedZip=address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
  const requested=normalize(address);
  const requestedHouse=requested.match(/\b\d+[A-Z]?\b/);
  const requestedStreet=requestedHouse ? requested.slice(requestedHouse.index) : '';
  const streetMatches=house&&street&&matchesStreet(requestedStreet,house,street,component('locality')?.long_name||'');
  const point=result.geometry?.location;
  if(result.partial_match || !streetMatches || !expectedZip || zip!==expectedZip || component('administrative_area_level_1')?.short_name!=='LA' || component('country')?.short_name!=='US') return {location:null,reason:'Address Needs Exact House, Street, And ZIP Match'};
  if(!['ROOFTOP','RANGE_INTERPOLATED'].includes(result.geometry?.location_type||'') || !point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || point.lat<29 || point.lat>31.3 || point.lng< -93 || point.lng> -89.4) return {location:null,reason:'Precise Service Location Unavailable'};
  return {location:{latitude:point.lat,longitude:point.lng},reason:'House, Street, And ZIP Verified'};
}

export function verifyCensusAddress(address:string,payload:unknown):AddressVerification {
  const matches=(payload as {result?:{addressMatches?:Array<{matchedAddress?:string;addressComponents?:{zip?:string;state?:string;city?:string};coordinates?:{x?:number;y?:number}}>}}|null)?.result?.addressMatches;
  if(!Array.isArray(matches) || matches.length!==1)return {location:null,reason:'Precise Service Location Unavailable'};
  const match=matches[0],street=String(match.matchedAddress || '').split(',')[0].trim().match(/^(\d+[A-Z]?)\s+(.+)$/i);
  if(!street)return {location:null,reason:'Address Needs Exact House, Street, And ZIP Match'};
  const component=(type:string,value:string)=>({types:[type],long_name:value,short_name:value});
  return verifyAddressResult(address,{status:'OK',results:[{address_components:[
    component('street_number',street[1]),component('route',street[2]),
    component('postal_code',match.addressComponents?.zip || ''),component('locality',match.addressComponents?.city || ''),
    component('administrative_area_level_1',match.addressComponents?.state || ''),component('country','US'),
  ],geometry:{location:{lat:match.coordinates?.y ?? NaN,lng:match.coordinates?.x ?? NaN},location_type:'RANGE_INTERPOLATED'}}]});
}
async function requestGeocode(address:string):Promise<unknown> {
  try {
    const params=new URLSearchParams({address:serviceAddressForGeocoding(address),benchmark:'Public_AR_Current',format:'json'});
    const response=await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`,{headers:{'User-Agent':'OpsCenter/1.0 (https://ops.junk-king.app)'},signal:AbortSignal.timeout(8_000),cache:'no-store'});
    return response.ok?await response.json():null;
  } catch {return null;}
}

const cache=new Map<string,{expires:number;result:Promise<AddressVerification>;verified?:AddressVerification}>();
export function cachedAddressVerification(address:string) { const row=cache.get(address);return row&&row.expires>Date.now()?row.verified:undefined; }
export async function verifyDesktopAddress(address:string):Promise<AddressVerification> {
  const prior=cache.get(address);if(prior&&prior.expires>Date.now())return prior.result;
  if(cache.size>=512)cache.delete(cache.keys().next().value!);
  const entry:{expires:number;result:Promise<AddressVerification>;verified?:AddressVerification}={expires:Date.now()+60_000,result:Promise.resolve({location:null,reason:'Checking Address'})};
  entry.result=requestGeocode(serviceAddressForGeocoding(address)).then(payload=>{const verified=verifyCensusAddress(address,payload);entry.verified=verified;entry.expires=Date.now()+(verified.location?86_400_000:300_000);return verified;});
  cache.set(address,entry);return entry.result;
}
