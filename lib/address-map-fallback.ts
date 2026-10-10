import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fullFieldStreetAddress, serviceStreetCandidates} from './appointment-partner';
import {cleanServiceQuery, normalizeServiceAddress, withoutServiceUnit} from './service-address-format';
import {serviceHouseAndStreet, normalizeHouseNumber} from './service-house-number';
import {parishAddressQuery} from './parish-service-address';
import {osmServiceAddressQuery} from './osm-service-address';
import {geocodioAddressQuery} from './geocodio-service-address';

/** Display evidence only. Never pass this point to visit detection or publish it
 * as a verified geocode. The source address remains the customer's instruction. */
export type AddressMapFallback = {
  location: {latitude:number;longitude:number};
  matchedAddress:string;
  source:string;
  sourceUrl:string;
  detail:string;
  stale:boolean;
};
type Candidate = {house:string;street:string;city:string;state:string;zip:string;latitude:number;longitude:number;source:string;sourceUrl:string;precision:string};
const normalize=normalizeServiceAddress;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const suffix=/ (ST|RD|AVE|DR|LN|CT|BLVD|PL|PKWY|TER|CIR|TRL|SQ|WAY|LOOP)$/;
function comparableStreet(value:string,city:string) {
  const stem=normalize(value).replace(suffix,'');
  const prefix=normalize(city)+' ';
  return stem.startsWith(prefix)?stem.slice(prefix.length):stem;
}
export function mapCandidateMatches(address:string,candidate:Candidate) {
  if(serviceStreetCandidates(address).length!==1)return false;
  if(![candidate.house,candidate.street,candidate.city,candidate.state,candidate.zip].every(value=>typeof value==='string'&&value.length>0))return false;
  const full=cleanServiceQuery(fullFieldStreetAddress(withoutServiceUnit(address)));
  const parsed=serviceHouseAndStreet(full);
  if(!parsed || normalizeHouseNumber(parsed.house)!==normalizeHouseNumber(candidate.house))return false;
  if(!candidate.street||!candidate.city||!candidate.zip||!candidate.state)return false;
  // A locality must be present in the requested field. Allow duplicate locality
  // text and an omitted state, but never substitute another city or direction.
  let tail=normalize(parsed.street).replace(/ \d{5}(?: \d{4})?$/,'').replace(/ LOUISIANA$/,' LA');
  const explicitState=tail.match(/ ([A-Z]{2})$/)?.[1];
  if(explicitState) {if(explicitState!==candidate.state)return false;tail=tail.slice(0,-3);}
  const sourceZip=full.match(/\b(\d{5})(?:-\d{4})?$/)?.[1];
  if(!explicitState && (!sourceZip || sourceZip.slice(0,3)!==candidate.zip.slice(0,3)))return false;
  const city=' '+normalize(candidate.city);
  if(!tail.endsWith(city))return false;
  do {tail=tail.slice(0,-city.length);} while(tail.endsWith(city));
  if(comparableStreet(tail,candidate.city)!==comparableStreet(candidate.street,candidate.city))return false;
  return Number.isFinite(candidate.latitude)&&Number.isFinite(candidate.longitude)
    &&candidate.latitude>=24&&candidate.latitude<=50&&candidate.longitude>=-125&&candidate.longitude<=-66;
}
function uniqueCandidate(address:string,rows:Candidate[],stale:boolean):AddressMapFallback|null {
  // A provider's competing results are not discarded to manufacture certainty.
  const identities=new Map(rows.map(row=>[JSON.stringify([row.house,row.street,row.city,row.state,row.zip,row.latitude,row.longitude]),row]));
  if(identities.size!==1)return null;
  const row=[...identities.values()][0];
  if(!mapCandidateMatches(address,row))return null;
  const matchedAddress=`${row.house} ${row.street}, ${row.city}, ${row.state} ${row.zip}`;
  return {location:{latitude:row.latitude,longitude:row.longitude},matchedAddress,source:row.source,sourceUrl:row.sourceUrl,stale,
    detail:`${stale?'Last available map result. ':''}${row.precision}. Exact service address is not verified.`};
}
function read(file:string):any {try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function cacheUsable(value:any,now:number) {return value&&Number.isFinite(value.expires)&&value.expires>now-7*86400_000;}

/** Reuse evidence from the already approved, rate-limited lookups. No new
 * provider calls, credentials, quota, paid requests or inferred coordinates. */
export function readAddressMapFallback(address:string,now=Date.now()):AddressMapFallback|null {
  const root=process.env.OPSCENTER_DATA_DIR||process.env.OPSBOT_DATA_DIR||path.join(process.env.HOME||'','.openclaw/workspace/opsbot/data');
  const parish=parishAddressQuery(address);
  if(parish?.provider==='tammany') {
    const cached=read(path.join(root,'cache/parish-address-lookups',hash(parish.url)+'.json'));
    if(cacheUsable(cached,now)&&!cached.failed&&cached.payload?.spatialReference?.wkid===4326&&!cached.payload?.exceededTransferLimit&&Array.isArray(cached.payload?.features)&&cached.payload.features.every((row:any)=>row&&typeof row==='object')) {
      // Parish lookup intentionally returns all streets with this house number.
      // Select only the requested street stem, retaining conflicting matches.
      const candidates:Candidate[]=(cached.payload.features||[]).flatMap((row:any)=>{
        const a=row.attributes,point=row.geometry,street=serviceHouseAndStreet(String(a?.ADDRESS||''));
        if(!street||!point||!Number.isInteger(a?.OBJECTID))return [];
        const candidate={house:street.house,street:street.street,city:String(a.CITY_L||''),state:'LA',zip:String(a.ZIP_CODE||''),latitude:point.y,longitude:point.x,source:'St. Tammany Parish',sourceUrl:parish.url,precision:'Possible address correction'};
        return mapCandidateMatches(address,candidate)?[candidate]:[];
      });
      const result=uniqueCandidate(address,candidates,cached.expires<=now);if(result)return result;
    }
  }
  const osmQuery=osmServiceAddressQuery(address);
  if(osmQuery) {
    const params=new URLSearchParams({q:osmQuery,format:'jsonv2',addressdetails:'1',limit:'5',countrycodes:'us'});
    const directory=process.env.OSM_ADDRESS_CACHE_DIR||path.join(root,'cache/osm-address-lookups');
    const cached=read(path.join(directory,hash('search?'+params)+'.json'));
    if(cacheUsable(cached,now)&&Array.isArray(cached.payload)&&cached.payload.every((row:any)=>row&&typeof row==='object')) {
      const rows:Candidate[]=cached.payload.map((row:any)=>{
        const a=row?.address||{};
        const state=String(a['ISO3166-2-lvl4']||'').replace(/^US-/,'')||({Louisiana:'LA',Mississippi:'MS',Florida:'FL'} as Record<string,string>)[a.state]||a.state;
        return {house:a.house_number||'',street:a.road||'',city:a.city||a.town||a.village||'',state:a.country_code==='us'?state:'',zip:String(a.postcode||'').slice(0,5),latitude:Number(row.lat),longitude:Number(row.lon),source:'OpenStreetMap',sourceUrl:`https://www.openstreetmap.org/${row.osm_type}/${row.osm_id}`,precision:'Provider map location'};
      });
      const result=uniqueCandidate(address,rows,cached.expires<=now);if(result)return result;
    }
  }
  const query=geocodioAddressQuery(address);
  if(query) {
    const stateFile=process.env.GEOCODIO_FREE_STATE_FILE||path.join(process.env.HOME||'','Library/Application Support/OpsCenter/geocodio-free-usage.json');
    const ledger=read(stateFile),cached=ledger?.schema===1?ledger.cache?.[hash(normalize(query))]:null;
    if(cacheUsable(cached,now)&&Array.isArray(cached.payload?.results)&&cached.payload.results.every((row:any)=>row&&typeof row==='object')) {
      const rows:Candidate[]=cached.payload.results.map((row:any)=>{
        const a=row?.address_components||{};
        return {house:a.number||'',street:a.formatted_street||'',city:a.city||'',state:a.country==='US'?a.state_province:'',zip:String(a.postal_code||'').slice(0,5),latitude:row.location?.lat,longitude:row.location?.lng,source:'Geocodio',sourceUrl:'https://api.geocod.io/v2/geocode',precision:row.accuracy_type==='range_interpolation'?'Estimated position along the street':'Provider map location'};
      });
      const result=uniqueCandidate(address,rows,cached.expires<=now);if(result)return result;
    }
  }
  return null;
}
