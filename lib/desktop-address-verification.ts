import { reviewedServiceAddress } from './reviewed-service-address';
import { verifyOsmAddressFallback } from './osm-service-address';
import { hasMinorStreetCorrection } from './address-spelling-correction';
import { sameCensusAddress, type CensusAddressMatch } from './census-address-matches';
import type { PlanningLocation } from './planning-geocodes';
import { fullFieldStreetAddress, serviceStreetCandidates } from './appointment-partner';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

type Component = { long_name: string; short_name: string; types: string[] };
type Result = { partial_match?: boolean; address_components?: Component[]; geometry?: { location?: { lat: number; lng: number }; location_type?: string } };
type Payload = { status?: string; results?: Result[] };
export const ADDRESS_VERIFICATION_POLICY = 3;
export type AddressVerification = { location: PlanningLocation | null; reason: string; matchedAddress?: string; source?: string; sourceUrl?: string; retryAfterMs?: number };
const aliases: Record<string,string> = { STREET:'ST',ROAD:'RD',AVENUE:'AVE',DRIVE:'DR',LANE:'LN',COURT:'CT',BOULEVARD:'BLVD',HIGHWAY:'HWY',PLACE:'PL',PARKWAY:'PKWY',TERRACE:'TER',CIRCLE:'CIR',TRAIL:'TRL',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W' };
const normalize = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).map(word=>aliases[word]||word).join(' ');
const normalizeRouteName = (text: string) => normalize(text).replace(/\bS NORMAN FRANCIS PKWY\b/g, 'S NORMAN C FRANCIS PKWY');

function matchesStreet(requested: string, house: string, street: string, city: string, zip: string) {
  // FMOL publishes both Clare and Claire for this Gonzales building. Scope
  // the alias to the verified house/locality; never fuzzy-match other streets.
  // Evidence links are in docs/schedule-finance-presentation.md.
  const canonical = (value: string) => {
    const text = normalizeRouteName(value);
    return house === '1014' && normalize(city) === 'GONZALES' && zip === '70737' && /\bGONZALES\b/.test(normalize(requested))
      ? text.replace(/\b1014 W (?:SAINT|ST) CLARE BLVD\b/g,'1014 W ST CLAIRE BLVD') : text;
  };
  const matched = canonical(`${house} ${street}`);
  const input = canonical(requested);
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
  if(serviceStreetCandidates(address).length>1) return {location:null,reason:'Multiple Street Addresses In Source Field'};
  if(payload.status!=='OK') return {location:null,reason:`Geocoding ${payload.status || 'Unavailable'}`};
  if(payload.results?.length!==1) return {location:null,reason:'Multiple Address Matches'};
  const result=payload.results[0];
  const component=(type:string)=>result.address_components?.find(value=>value.types.includes(type));
  const house=component('street_number')?.long_name;
  const street=component('route')?.long_name;
  const zip=component('postal_code')?.long_name;
  const expectedZip=address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
  const requested=normalize(fullFieldStreetAddress(address));
  const requestedHouse=requested.match(/\b\d+[A-Z]?\b/);
  const requestedStreet=requestedHouse ? requested.slice(requestedHouse.index) : '';
  const streetMatches=house&&street&&matchesStreet(requestedStreet,house,street,component('locality')?.long_name||'',zip || '');
  const point=result.geometry?.location;
  if(result.partial_match || !streetMatches || !expectedZip || zip!==expectedZip || component('administrative_area_level_1')?.short_name!=='LA' || component('country')?.short_name!=='US') return {location:null,reason:'Address Needs Exact House, Street, And ZIP Match'};
  if(!['ROOFTOP','RANGE_INTERPOLATED'].includes(result.geometry?.location_type||'') || !point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || point.lat<29 || point.lat>31.3 || point.lng< -93 || point.lng> -89.4) return {location:null,reason:'Precise Service Location Unavailable'};
  return {location:{latitude:point.lat,longitude:point.lng},reason:'House, Street, And ZIP Verified'};
}

export function verifyCensusAddress(address:string,payload:unknown):AddressVerification {
  const matches=(payload as {result?:{addressMatches?:CensusAddressMatch[]}}|null)?.result?.addressMatches;
  if(!Array.isArray(matches) || !matches.length)return {location:null,reason:'Precise Service Location Unavailable'};
  if(matches.length > 1) {
    if(!sameCensusAddress(matches))return {location:null,reason:'Multiple Address Matches'};
    const verified=matches.map(match=>verifyCensusAddress(address,{result:{addressMatches:[match]}}));
    return verified.find(result=>result.location && !result.matchedAddress) || verified.find(result=>result.location) || verified[0];
  }
  const match=matches[0],street=String(match.matchedAddress || '').split(',')[0].trim().match(/^(\d+[A-Z]?)\s+(.+)$/i);
  if(!street)return {location:null,reason:'Address Needs Exact House, Street, And ZIP Match'};
  const component=(type:string,value:string)=>({types:[type],long_name:value,short_name:value});
  const payloadForVerification: Payload = {status:'OK',results:[{address_components:[
    component('street_number',street[1]),component('route',street[2]),
    component('postal_code',match.addressComponents?.zip || ''),component('locality',match.addressComponents?.city || ''),
    component('administrative_area_level_1',match.addressComponents?.state || ''),component('country','US'),
  ],geometry:{location:{lat:match.coordinates?.y ?? NaN,lng:match.coordinates?.x ?? NaN},location_type:'RANGE_INTERPOLATED'}}]};
  const exact = verifyAddressResult(address,payloadForVerification);
  if (exact.location || exact.reason !== 'Address Needs Exact House, Street, And ZIP Match') return exact;
  if (serviceStreetCandidates(address).length > 1) return exact;
  const requested = normalize(fullFieldStreetAddress(address)).replace(/ (\d{5}) \d{4}$/, ' $1');
  if (!hasMinorStreetCorrection(requested,normalize(street[1]),normalize(street[2]),normalize(match.addressComponents?.city || ''),match.addressComponents?.zip || '')) return exact;
  // Only Census's single full-address match gets this spelling tolerance. All
  // coordinate, state, country and precision checks still run on its result.
  const corrected = verifyAddressResult(match.matchedAddress || '',payloadForVerification);
  return corrected.location ? {...corrected,reason:'Minor Street Spelling Correction Verified',matchedAddress:match.matchedAddress} : exact;
}
async function requestGeocode(address:string):Promise<unknown> {
  try {
    const params=new URLSearchParams({address,benchmark:'Public_AR_Current',format:'json'});
    const response=await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`,{headers:{'User-Agent':'OpsCenter/1.0 (https://ops.junk-king.app)'},signal:AbortSignal.timeout(8_000),cache:'no-store'});
    return response.ok?await response.json():null;
  } catch {return null;}
}

const cache=new Map<string,{expires:number;result:Promise<AddressVerification>;verified?:AddressVerification}>();
const cacheFile = (address: string) => path.join(process.env.SERVICE_ADDRESS_CACHE_DIR || path.join(process.cwd(),'data','cache','service-address-verifications'),createHash('sha256').update(address).digest('hex')+'.json');
export function cachedAddressVerification(address:string):AddressVerification|undefined {
  const reviewed = reviewedServiceAddress(address); if (reviewed) return reviewed;
  const row=cache.get(address);
  if(row && row.expires>Date.now()) return row.verified;
  try {
    const stored=JSON.parse(fs.readFileSync(cacheFile(address),'utf8'));
    if(![1,2,3].includes(stored.schema) || stored.address !== address || stored.expires <= Date.now()) return undefined;
    // Reconsider failures from the old exact-spelling policy immediately.
    if(stored.schema < ADDRESS_VERIFICATION_POLICY && !stored.verified?.location) return undefined;
    const point=stored.verified?.location;
    if(point && (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || point.latitude<29 || point.latitude>31.3 || point.longitude< -93 || point.longitude> -89.4)) return undefined;
    cache.set(address,{expires:stored.expires,verified:stored.verified,result:Promise.resolve(stored.verified)});
    return stored.verified as AddressVerification;
  } catch { return undefined; }
}
export function addressQueries(address: string) {
  const full=address.replace(/\s+/g,' ').replace(/\s*,\s*/g,', ').trim();
  const street=fullFieldStreetAddress(full);
  // Keep suite/business context in the original and first attempts. Only the
  // routing query may omit an explicit unit; validation always uses full input.
  const withoutUnit=street.replace(/\b(?:suite|ste|unit|apt|apartment|floor|fl)\.?\s+[A-Z0-9-]+\b\s*,?\s*/ig,' ').replace(/\s+/g,' ').trim();
  const withState = /\b(?:LA|LOUISIANA)\s+\d{5}/i.test(withoutUnit) ? withoutUnit : withoutUnit.replace(/[,\s]+(\d{5}(?:-\d{4})?)$/, ', LA $1');
  return [...new Set([full,street,withoutUnit,withState])];
}
export async function verifyDesktopAddress(address:string):Promise<AddressVerification> {
  if(serviceStreetCandidates(address).length>1) return {location:null,reason:'Multiple Street Addresses In Source Field'};
  const disk=cachedAddressVerification(address); if(disk) return disk;
  const prior=cache.get(address);if(prior&&prior.expires>Date.now())return prior.result;
  if(cache.size>=512)cache.delete(cache.keys().next().value!);
  const entry:{expires:number;result:Promise<AddressVerification>;verified?:AddressVerification}={expires:Date.now()+60_000,result:Promise.resolve({location:null,reason:'Checking Address'})};
  entry.result=(async()=>{
    let verified:AddressVerification={location:null,reason:'Precise Service Location Unavailable'};
    let ambiguous=false;
    const started=Date.now();
    for(const query of addressQueries(address)) {
      if(Date.now()-started>=16000)break;
      verified=verifyCensusAddress(address,await requestGeocode(query));
      if(verified.reason==='Multiple Address Matches')ambiguous=true;
      if(verified.location) break;
    }
    if(!verified.location && !ambiguous)verified=await verifyOsmAddressFallback(address,Math.max(0,27000-(Date.now()-started)-8000));
    if(!verified.location && ambiguous)verified={location:null,reason:'Multiple Address Matches'};
    entry.verified=verified;entry.expires=Date.now()+(verified.retryAfterMs || (verified.location?7*86_400_000:300_000));
    const file=cacheFile(address), temporary=file+'.'+randomUUID()+'.tmp';
    try {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temporary,JSON.stringify({schema:ADDRESS_VERIFICATION_POLICY,address,expires:entry.expires,verified}),{mode:0o660});fs.chmodSync(temporary,0o660);fs.renameSync(temporary,file);} catch {try{fs.unlinkSync(temporary);}catch{/* Cache failure must not fabricate or discard verification. */}}
    return verified;
  })();
  cache.set(address,entry);return entry.result;
}
