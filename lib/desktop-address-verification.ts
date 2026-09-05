import { get } from 'node:https';
import type { PlanningLocation } from './planning-geocodes';

type Component = { long_name: string; short_name: string; types: string[] };
type Result = { partial_match?: boolean; address_components?: Component[]; geometry?: { location?: { lat: number; lng: number }; location_type?: string } };
type Payload = { status?: string; results?: Result[] };
export type AddressVerification = { location: PlanningLocation | null; reason: string };
const aliases: Record<string,string> = { STREET:'ST',ROAD:'RD',AVENUE:'AVE',DRIVE:'DR',LANE:'LN',COURT:'CT',BOULEVARD:'BLVD',HIGHWAY:'HWY',PLACE:'PL',PARKWAY:'PKWY',TERRACE:'TER',CIRCLE:'CIR',TRAIL:'TRL',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W' };
const normalize = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).map(word=>aliases[word]||word).join(' ');

// Match returned components, never a city centroid or a nearby street/house.
export function verifyGoogleAddress(address: string, payload: Payload): AddressVerification {
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
  const matchedStreet=house&&street?normalize(`${house} ${street}`):'';
  const point=result.geometry?.location;
  if(result.partial_match || !matchedStreet || !(requestedStreet===matchedStreet || requestedStreet.startsWith(`${matchedStreet} `)) || !expectedZip || zip!==expectedZip || component('administrative_area_level_1')?.short_name!=='LA' || component('country')?.short_name!=='US') return {location:null,reason:'Address Needs Exact House, Street, And ZIP Match'};
  if(!['ROOFTOP','RANGE_INTERPOLATED'].includes(result.geometry?.location_type||'') || !point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || point.lat<29 || point.lat>31.3 || point.lng< -93 || point.lng> -89.4) return {location:null,reason:'Precise Service Location Unavailable'};
  return {location:{latitude:point.lat,longitude:point.lng},reason:'Google House, Street, And ZIP Verified'};
}

// IPv4 preserves the existing server-key egress restriction. Never log keys,
// requests, provider error bodies, or customer addresses.
function requestGeocode(address: string): Promise<Payload> {
  const key=process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_ROUTES_API_KEY;
  if(!key) return Promise.resolve({status:'Not Configured'});
  return new Promise(resolve=>{
    const req=get({hostname:'maps.googleapis.com',family:4,path:`/maps/api/geocode/json?${new URLSearchParams({address,key})}`,signal:AbortSignal.timeout(8_000)},response=>{
      if(response.statusCode!==200){response.resume();resolve({status:'Provider Unavailable'});return;}
      let body='';
      response.on('data',chunk=>{body+=chunk;if(body.length>262144){response.destroy();resolve({status:'Invalid Response'});}});
      response.on('end',()=>{try{resolve(JSON.parse(body));}catch{resolve({status:'Invalid Response'});}});
      response.on('error',()=>resolve({status:'Provider Unavailable'}));
      response.on('aborted',()=>resolve({status:'Provider Unavailable'}));
    });
    req.on('error',()=>resolve({status:'Provider Unavailable'}));
  });
}

const cache=new Map<string,{expires:number;result:Promise<AddressVerification>;verified?:AddressVerification}>();
export function cachedAddressVerification(address:string) { const row=cache.get(address);return row&&row.expires>Date.now()?row.verified:undefined; }
export async function verifyDesktopAddress(address:string):Promise<AddressVerification> {
  const prior=cache.get(address);if(prior&&prior.expires>Date.now())return prior.result;
  if(cache.size>=512)cache.delete(cache.keys().next().value!);
  const entry:{expires:number;result:Promise<AddressVerification>;verified?:AddressVerification}={expires:Date.now()+60_000,result:Promise.resolve({location:null,reason:'Checking Address'})};
  entry.result=requestGeocode(address).then(payload=>{const verified=verifyGoogleAddress(address,payload);entry.verified=verified;entry.expires=Date.now()+(verified.location?86_400_000:300_000);return verified;});
  cache.set(address,entry);return entry.result;
}
