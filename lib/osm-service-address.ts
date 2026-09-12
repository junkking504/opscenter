import { fullFieldStreetAddress, serviceStreetCandidates } from './appointment-partner';
import { osmAddressJson } from './osm-address-transport';
import type { AddressVerification } from './desktop-address-verification';

const aliases:Record<string,string>={STREET:'ST',ROAD:'RD',AVENUE:'AVE',DRIVE:'DR',LANE:'LN',COURT:'CT',BOULEVARD:'BLVD',HIGHWAY:'HWY',PLACE:'PL',PARKWAY:'PKWY',TERRACE:'TER',CIRCLE:'CIR',TRAIL:'TRL',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W'};
const normalize=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).map(word=>aliases[word]||word).join(' ');
export function osmServiceAddressQuery(address:string):string|null {
  if(serviceStreetCandidates(address).length!==1)return null;
  // Only the service address goes to OSM, never customer names, notes, business
  // prefixes, phone numbers or unit identifiers. Keep the city; omit ZIP to
  // allow an exact building match when a source postal code is wrong.
  const street=fullFieldStreetAddress(address).replace(/\b(?:suite|ste|unit|apt|apartment|floor|fl)\.?\s+[A-Z0-9-]+\b\s*,?\s*/ig,' ').replace(/[,\s]+\d{5}(?:-\d{4})?\s*$/,'').trim();
  return street === address.trim() && !/\d{5}\s*$/.test(address) ? null : street.replace(/\s+/g,' ');
}
type OsmAddress = {lat?:string;lon?:string;osm_type?:string;osm_id?:number;place_rank?:number;category?:string;type?:string;boundingbox?:string[];address?:Record<string,string>};
export function verifyOsmServiceAddress(address:string,payload:unknown):AddressVerification {
  const unavailable={location:null,reason:'No Exact Building Match'};
  const query=osmServiceAddressQuery(address);
  if(!query || !Array.isArray(payload) || !payload.length)return unavailable;
  // Do not filter away competing results to manufacture a unique match.
  if(payload.some(row=>!row || typeof row!=='object'))return unavailable;
  const rows=payload as OsmAddress[];
  const identities=new Set(rows.map(row=>JSON.stringify([row.osm_type,row.osm_id,row.lat,row.lon,row.address])));
  if(identities.size!==1)return {location:null,reason:'Multiple Address Matches'};
  const row=rows[0],a=row.address || {},city=a.city||a.town||a.village||'';
  const requested=normalize(query).replace(/ (?:LA|LOUISIANA)$/,'');
  const matched=normalize(`${a.house_number||''} ${a.road||''} ${city}`);
  const zip=a.postcode?.match(/^\d{5}(?:-\d{4})?$/)?.[0].slice(0,5);
  const sourceZip=address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
  if(!city || !a.house_number || !a.road || !zip || !sourceZip || requested!==matched || a.country_code!=='us' || !['Louisiana','LA'].includes(a.state||'') || sourceZip.slice(0,3)!==zip.slice(0,3))return unavailable;
  const latitude=Number(row.lat),longitude=Number(row.lon);
  const bbox=row.boundingbox?.map(Number);
  const building=row.category==='building' || (row.category==='place' && row.type==='house');
  if(!building || row.place_rank!==30 || !['node','way'].includes(row.osm_type||'') || !row.osm_id || !row.lat || !row.lon || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude<29 || latitude>31.3 || longitude< -93 || longitude> -89.4 || bbox?.length!==4 || !bbox.every(Number.isFinite) || bbox[1]<bbox[0] || bbox[3]<bbox[2] || bbox[1]-bbox[0]>0.003 || bbox[3]-bbox[2]>0.003 || latitude<bbox[0] || latitude>bbox[1] || longitude<bbox[2] || longitude>bbox[3])return {location:null,reason:'Precise Building Location Unavailable'};
  return {location:{latitude,longitude},reason:sourceZip===zip?'Exact OpenStreetMap Building Verified':'Exact Building Verified · Source ZIP Differs',matchedAddress:`${a.house_number} ${a.road}, ${city}, LA ${zip}`,source:'OpenStreetMap',sourceUrl:`https://www.openstreetmap.org/${row.osm_type}/${row.osm_id}`};
}
export async function verifyOsmAddressFallback(address:string,waitBudgetMs=0):Promise<AddressVerification> {
  const query=osmServiceAddressQuery(address);
  if(!query)return {location:null,reason:'Address Needs Review'};
  const result=await osmAddressJson('search',new URLSearchParams({q:query,format:'jsonv2',addressdetails:'1',limit:'5',countrycodes:'us'}),waitBudgetMs);
  if(result.retryAfterMs)return {location:null,reason:'Automatic Address Check Pending',retryAfterMs:result.retryAfterMs};
  return verifyOsmServiceAddress(address,result.payload);
}
