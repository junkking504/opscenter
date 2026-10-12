import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fullFieldStreetAddress, serviceStreetCandidates} from './appointment-partner';
import {cleanServiceQuery, normalizeServiceAddress, withoutServiceUnit} from './service-address-format';
import {serviceHouseAndStreet, normalizeHouseNumber} from './service-house-number';
import {parishAddressQuery} from './parish-service-address';
import {osmMapAddressQuery} from './osm-service-address';
import {geocodioAddressQuery} from './geocodio-service-address';
import {approximateMapAddressQuery} from './address-map-query';

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
type Candidate = {house:string;street:string;city:string;state:string;zip:string;latitude:number;longitude:number;source:string;sourceUrl:string;precision:string;confidence?:number;streetOnly?:boolean};
type CachedCandidate = Candidate & {stale:boolean};
const normalize=normalizeServiceAddress;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const suffix=/ (ST|RD|AVE|DR|LN|CT|BLVD|PL|PKWY|TER|CIR|TRL|SQ|WAY|LOOP)$/;
// These are display-only interpretations. Keep the original unit on the job,
// and never loosen the exact-property verifier to accommodate a guessed pin.
const bareMapUnit=/(\b(?:ST|STREET|RD|ROAD|AVE|AVENUE|DR|DRIVE|LN|LANE|CT|COURT|BLVD|BOULEVARD|PL|PLACE|PKWY|PARKWAY|TER|TERRACE|CIR|CIRCLE|TRL|TRAIL)\.?)\s+(\d{1,4}-\d{1,4}[A-Z]?)(?=[,\s]+[A-Z]|$)/ig;
function mapAddress(value:string) {return approximateMapAddressQuery(value).replace(bareMapUnit,'$1 Unit $2');}
function mapStreet(value:string) {return withoutServiceUnit(mapAddress(value)).replace(/\s+(?:CLUBHOUSE|LEASING OFFICE)\b.*$/i,'').trim();}
function mapUnit(value:string) {
  return mapAddress(value).match(/\b(?:UNIT|APT|APARTMENT|STE|SUITE|BLDG|BUILDING)\.?\s*#?\s*([A-Z0-9]+(?:-[A-Z0-9]+)*)\b/i)?.[1].toUpperCase().replace(/-/g,'') || '';
}
function comparableStreet(value:string,city:string) {
  const stem=normalize(mapStreet(value)).replace(suffix,'');
  const prefix=normalize(city)+' ';
  return stem.startsWith(prefix)?stem.slice(prefix.length):stem;
}
export function mapCandidateMatches(address:string,candidate:Candidate) {
  if(serviceStreetCandidates(mapAddress(address)).length!==1)return false;
  if(typeof candidate.house!=='string'||![candidate.street,candidate.city,candidate.state,candidate.zip].every(value=>typeof value==='string'&&value.length>0))return false;
  const full=cleanServiceQuery(fullFieldStreetAddress(withoutServiceUnit(mapAddress(address))));
  const parsed=serviceHouseAndStreet(full);
  if(!parsed || (candidate.streetOnly ? candidate.house!=='' : !candidate.house||normalizeHouseNumber(parsed.house)!==normalizeHouseNumber(candidate.house)))return false;
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
  // With no premises evidence, require the complete road name and ZIP rather
  // than guessing between similarly named roads in the same locality.
  if(candidate.streetOnly && (normalize(mapStreet(tail))!==normalize(mapStreet(candidate.street))||sourceZip!==candidate.zip))return false;
  return Number.isFinite(candidate.latitude)&&Number.isFinite(candidate.longitude)
    &&candidate.latitude>=24&&candidate.latitude<=50&&candidate.longitude>=-125&&candidate.longitude<=-66;
}
function candidateScore(address:string,row:CachedCandidate) {
  const source=normalize(withoutServiceUnit(mapAddress(address)));
  const sourceUnit=mapUnit(address),unit=mapUnit(row.street);
  const street=normalize(mapStreet(row.street));
  const zip=address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
  // Favor the requested unit; otherwise a premises/entrance pin is more useful
  // than an arbitrary neighboring apartment. Ties use a stable identity below.
  return (!row.streetOnly ? 10000 : 0)
    + (sourceUnit && sourceUnit===unit ? 1000 : !unit ? 100 : 0)
    + (source.includes(` ${street} `) ? 200 : 0)
    + (zip===row.zip ? 80 : 0)
    + (!row.stale ? 40 : 0)
    + (/Parish/.test(row.source) ? 20 : row.source==='OpenStreetMap' ? 10 : 0)
    + (/along the street/.test(row.precision) ? 0 : 5)
    + (Number.isFinite(row.confidence) ? Math.max(0,Math.min(1,row.confidence!)) : 0);
}
function bestCandidate(address:string,rows:CachedCandidate[]):AddressMapFallback|null {
  const identity=(row:Candidate)=>JSON.stringify([row.house,row.street,row.city,row.state,row.zip,row.latitude,row.longitude,row.source]);
  const matches=rows.filter(row=>mapCandidateMatches(address,row));
  matches.sort((a,b)=>candidateScore(address,b)-candidateScore(address,a) || identity(a).localeCompare(identity(b)));
  const row=matches[0];
  if(!row)return null;
  const matchedAddress=`${[row.house,row.street].filter(Boolean).join(' ')}, ${row.city}, ${row.state} ${row.zip}`;
  return {location:{latitude:row.latitude,longitude:row.longitude},matchedAddress,source:row.source,sourceUrl:row.sourceUrl,stale:row.stale,
    detail:`${row.stale?'Last available map result. ':''}Best available address match. ${row.precision}.`};
}
function read(file:string):any {try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function cacheUsable(value:any,now:number) {return value&&Number.isFinite(value.expires)&&value.expires>now-7*86400_000;}
function usableOsmStreetPoint(row:any) {
  if(row.category!=='highway'||row.addresstype!=='road'||row.osm_type!=='way'||!Number.isInteger(row.osm_id)||!Array.isArray(row.boundingbox))return false;
  const bounds=row.boundingbox.map(Number),latitude=Number(row.lat),longitude=Number(row.lon);
  // A bounded road segment is useful display evidence. A long highway or
  // locality centroid is not a useful guess for a particular service address.
  return bounds.length===4&&bounds.every(Number.isFinite)&&bounds[1]>bounds[0]&&bounds[3]>bounds[2]
    &&bounds[1]-bounds[0]<=0.03&&bounds[3]-bounds[2]<=0.03
    &&latitude>=bounds[0]&&latitude<=bounds[1]&&longitude>=bounds[2]&&longitude<=bounds[3];
}

/** Reuse evidence from the already approved, rate-limited lookups. No new
 * provider calls, credentials, quota, paid requests or inferred coordinates. */
export function readAddressMapFallback(address:string,now=Date.now()):AddressMapFallback|null {
  const root=process.env.OPSCENTER_DATA_DIR||process.env.OPSBOT_DATA_DIR||path.join(process.env.HOME||'','.openclaw/workspace/opsbot/data');
  const candidates:CachedCandidate[]=[];
  const files=new Map<string,any>();
  const cachedFile=(file:string)=>{if(!files.has(file))files.set(file,read(file));return files.get(file);};
  const queries=[...new Set([address,withoutServiceUnit(mapAddress(address))])];
  for(const lookup of queries) {
    const parish=parishAddressQuery(lookup);
    if(parish) {
      const cached=cachedFile(path.join(root,'cache/parish-address-lookups',hash(parish.url)+'.json'));
      if(cacheUsable(cached,now)&&!cached.failed&&cached.payload?.spatialReference?.wkid===4326&&Array.isArray(cached.payload?.features)) {
        // Parish lookup intentionally returns all streets with this house number.
        // A partial result may still supply a useful approximate pin; it cannot
        // establish exact verification or complete address coverage.
        candidates.push(...cached.payload.features.flatMap((row:any)=>{
          const a=row?.attributes,point=row?.geometry,tammany=parish.provider==='tammany';
          const street=serviceHouseAndStreet(String(tammany?a?.ADDRESS||'':a?.FULL_ADDRESS||''));
          if(!street||!point||!Number.isInteger(tammany?a?.OBJECTID:a?.ADDRESS_ID))return [];
          return [{house:street.house,street:street.street,city:String(tammany?a.CITY_L||'':a.CITY||''),state:tammany?'LA':String(a.STATE||''),zip:String(tammany?a.ZIP_CODE||'':a.ZIP||''),latitude:point.y,longitude:point.x,source:tammany?'St. Tammany Parish':'East Baton Rouge Parish',sourceUrl:parish.url,precision:'Parish address point',stale:cached.expires<=now}];
        }));
      }
    }
    const osmQuery=osmMapAddressQuery(lookup);
    if(osmQuery) {
      const params=new URLSearchParams({q:osmQuery,format:'jsonv2',addressdetails:'1',limit:'5',countrycodes:'us'});
      const directory=process.env.OSM_ADDRESS_CACHE_DIR||path.join(root,'cache/osm-address-lookups');
      const cached=cachedFile(path.join(directory,hash('search?'+params)+'.json'));
      if(cacheUsable(cached,now)&&Array.isArray(cached.payload)&&cached.payload.every((row:any)=>row&&typeof row==='object')) {
        const rows:Candidate[]=cached.payload.flatMap((row:any)=>{
          const a=row?.address||{};
          const streetOnly=!a.house_number&&usableOsmStreetPoint(row);
          if(!a.house_number&&!streetOnly)return [];
          const state=String(a['ISO3166-2-lvl4']||'').replace(/^US-/,'')||({Louisiana:'LA',Mississippi:'MS',Florida:'FL'} as Record<string,string>)[a.state]||a.state;
          return [{house:a.house_number||'',street:[a.road,a.unit?`Unit ${a.unit}`:''].filter(Boolean).join(' '),city:a.city||a.town||a.village||'',state:a.country_code==='us'?state:'',zip:String(a.postcode||'').slice(0,5),latitude:row.lat==null?NaN:Number(row.lat),longitude:row.lon==null?NaN:Number(row.lon),source:'OpenStreetMap',sourceUrl:`https://www.openstreetmap.org/${row.osm_type}/${row.osm_id}`,precision:streetOnly?'Approximate street location; house number not located':'Provider map location',streetOnly}];
        });
        candidates.push(...rows.map(row=>({...row,stale:cached.expires<=now})));
      }
    }
    const query=geocodioAddressQuery(lookup);
    if(query) {
      const stateFile=process.env.GEOCODIO_FREE_STATE_FILE||path.join(process.env.HOME||'','Library/Application Support/OpsCenter/geocodio-free-usage.json');
      const ledger=cachedFile(stateFile),cached=ledger?.schema===1?ledger.cache?.[hash(normalize(query))]:null;
      if(cacheUsable(cached,now)&&Array.isArray(cached.payload?.results)&&cached.payload.results.every((row:any)=>row&&typeof row==='object')) {
        const rows:Candidate[]=cached.payload.results.map((row:any)=>{
          const a=row?.address_components||{};
          const unit=a.unit_number||a.secondarynumber;
          return {house:a.number||'',street:[a.formatted_street,unit?`Unit ${unit}`:''].filter(Boolean).join(' '),city:a.city||'',state:a.country==='US'?a.state_province:'',zip:String(a.postal_code||'').slice(0,5),latitude:row.location?.lat,longitude:row.location?.lng,source:'Geocodio',sourceUrl:'https://api.geocod.io/v2/geocode',precision:row.accuracy_type==='range_interpolation'?'Estimated position along the street':'Provider map location',confidence:row.accuracy};
        });
        candidates.push(...rows.map(row=>({...row,stale:cached.expires<=now})));
      }
    }
  }
  return bestCandidate(address,candidates);
}
