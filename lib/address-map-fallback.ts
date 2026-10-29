import {readReviewedAddressNavigation} from './reviewed-address-navigation';
import {propertyNameSearch} from './property-name-search';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fullFieldStreetAddress, serviceStreetCandidates} from './appointment-partner';
import {cleanServiceQuery, legacyServiceQuery, normalizeServiceAddress, serviceUnitIdentifiers, withoutServiceUnit} from './service-address-format';
import {serviceHouseAndStreet, normalizeHouseNumber} from './service-house-number';
import {parishAddressQuery} from './parish-service-address';
import {osmMapAddressQuery} from './osm-service-address';
import {geocodioAddressQuery} from './geocodio-service-address';
import {approximateMapAddressQuery} from './address-map-query';
import {gpsDistanceMeters} from './gps-presence-policy';
import {ZIP_CENTERS} from './zip-centers';

/** Map evidence retains its confidence label when used for navigation or GPS matching. */
export type AddressMapFallback = {
  location: {latitude:number;longitude:number};
  matchedAddress:string;
  source:string;
  sourceUrl:string;
  detail:string;
  stale:boolean;
  /** Legacy stored metadata; operational eligibility is decided from coordinates. */
  visitEligible?:false;
  navigationReviewed?:true;
  /** Last-resort ZIP-area center: travel/map estimate only, not a property pin. */
  zipArea?:true;
};
type Candidate = {house:string;street:string;city:string;state:string;zip:string;latitude:number;longitude:number;source:string;sourceUrl:string;precision:string;confidence?:number;rooftop?:boolean;streetOnly?:boolean;bounds?:number[];streetZipCorroborated?:boolean};
type CachedCandidate = Candidate & {stale:boolean};
const normalize=normalizeServiceAddress;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const suffix=/ (ST|RD|AVE|DR|LN|CT|BLVD|PL|PKWY|TER|CIR|TRL|TRCE|SQ|WAY|LOOP)$/;
// These are display-only interpretations. Keep the original unit on the job,
// and never loosen the exact-property verifier to accommodate a guessed pin.
const bareMapUnit=/(\b(?:ST|STREET|RD|ROAD|AVE|AVENUE|DR|DRIVE|LN|LANE|CT|COURT|BLVD|BOULEVARD|PL|PLACE|PKWY|PARKWAY|TER|TERRACE|CIR|CIRCLE|TRL|TRAIL)\.?)\s+(\d{1,4}-\d{1,4}[A-Z]?)(?=[,\s]+[A-Z]|$)/ig;
function mapAddress(value:string) {return approximateMapAddressQuery(value).replace(bareMapUnit,'$1 Unit $2');}
function mapStreet(value:string) {return withoutServiceUnit(mapAddress(value)).replace(/\s+(?:CLUBHOUSE|LEASING OFFICE)\b.*$/i,'').trim();}
function mapUnit(value:string) {
  return serviceUnitIdentifiers(mapAddress(value))[0] || '';
}
function comparableStreet(value:string,city:string) {
  const stem=normalize(mapStreet(value)).replace(suffix,'');
  const prefix=normalize(city)+' ';
  return stem.startsWith(prefix)?stem.slice(prefix.length):stem;
}
// A provider may publish a shared building without the source house's letter.
// This is an approximate building, never a replacement for the source suffix.
function omittedHouseSuffix(address:string,candidate:Candidate) {
  // A compact highway direction is handled separately with stronger evidence;
  // it must not fall through to a directionless base-building guess.
  if(/^\d+[NSEW]\s+(?:HWY|HIGHWAY)\s+\d+\b/i.test(address.trim()))return '';
  const parsed=serviceHouseAndStreet(cleanServiceQuery(fullFieldStreetAddress(withoutServiceUnit(mapAddress(address)))));
  const parts=parsed && normalizeHouseNumber(parsed.house).match(/^(\d+)([A-Z])$/);
  if(!parts || normalizeHouseNumber(candidate.house)!==parts[1])return '';
  const unit=mapUnit(candidate.street),sourceUnit=mapUnit(address);
  if(unit && unit!==parts[2] || sourceUnit && sourceUnit!==parts[2])return '';
  return parts[2];
}
// A joined cardinal letter before an unqualified numbered highway can mean
// either a house suffix or a road direction. Only existing rooftop evidence
// may support the latter for navigation. Do not globally alias Hwy to US/LA,
// split other alphanumeric houses, change provider queries, or verify a pin.
function compactHighwayMatch(address:string,candidate:Candidate) {
  if(candidate.source!=='Geocodio' || !candidate.rooftop || candidate.streetOnly
    || candidate.state!=='LA' || serviceUnitIdentifiers(candidate.street).length
    || candidate.latitude<29 || candidate.latitude>31.3 || candidate.longitude< -93 || candidate.longitude> -89.4) return false;
  const source=address.trim().match(/^(\d+)([NSEW])\s+(?:HWY|HIGHWAY)\s+(\d+)[,\s]+([A-Z][A-Z .'-]*?),?\s+(?:(LA|LOUISIANA)[,\s]+)?(\d{5})(?:-\d{4})?$/i);
  const road=candidate.street.trim().match(/^(N|S|E|W|NORTH|SOUTH|EAST|WEST)\s+(?:(?:US|U\.S\.|LA|LOUISIANA|STATE)[ -]*(?:(?:HWY|HIGHWAY|ROUTE)\s+)?|(?:HWY|HIGHWAY)\s+)(\d+)$/i);
  return Boolean(source && road && candidate.house===source[1]
    && normalize(road[1])===source[2].toUpperCase() && road[2]===source[3]
    && normalize(candidate.city)===normalize(source[4]) && candidate.zip===source[6]);
}
// Some sources write a road's direction after its suffix. Only a matching
// rooftop may move that same direction before the street for display. This
// does not equate opposite directions or change exact address verification.
function relocatedDirectionMatch(address:string,candidate:Candidate) {
  if(candidate.source!=='Geocodio' || !candidate.rooftop || candidate.streetOnly
    || serviceUnitIdentifiers(candidate.street).length) return false;
  const full=normalize(cleanServiceQuery(fullFieldStreetAddress(address)));
  const tail=` ${normalize(candidate.city)} ${candidate.state} ${candidate.zip}`;
  const noStateTail=` ${normalize(candidate.city)} ${candidate.zip}`;
  const postal=full.endsWith(tail)?tail:full.endsWith(noStateTail)?noStateTail:null;
  if(!postal) return false;
  const road=serviceHouseAndStreet(full.slice(0,-postal.length));
  const parts=road?.street.match(/^([A-Z][A-Z0-9 ]* (?:ST|RD|AVE|DR|LN|CT|BLVD|PL|PKWY|TER|CIR|TRL|TRCE|SQ|WAY|LOOP)) (N|S|E|W|NE|NW|SE|SW)$/);
  return Boolean(road && parts && !/^(?:N|S|E|W|NE|NW|SE|SW) /.test(parts[1])
    && normalizeHouseNumber(road.house)===normalizeHouseNumber(candidate.house)
    && `${parts[2]} ${parts[1]}`===normalize(candidate.street));
}
export function mapCandidateMatches(address:string,candidate:Candidate) {
  if(serviceStreetCandidates(mapAddress(address)).length!==1)return false;
  if(typeof candidate.house!=='string'||![candidate.street,candidate.city,candidate.state,candidate.zip].every(value=>typeof value==='string'&&value.length>0))return false;
  if(!Number.isFinite(candidate.latitude)||!Number.isFinite(candidate.longitude)
    ||candidate.latitude<24||candidate.latitude>50||candidate.longitude< -125||candidate.longitude> -66)return false;
  const sourceUnits=serviceUnitIdentifiers(mapAddress(address)),candidateUnits=serviceUnitIdentifiers(mapAddress(candidate.street));
  // A complex entrance can omit a unit, but another explicit unit cannot stand
  // in for the requested one. Multiple unit/building identities stay unresolved.
  if(new Set(sourceUnits).size>1 || new Set(candidateUnits).size>1
    || sourceUnits.length && candidateUnits.length && sourceUnits[0]!==candidateUnits[0])return false;
  if(compactHighwayMatch(address,candidate) || relocatedDirectionMatch(address,candidate))return true;
  const full=cleanServiceQuery(fullFieldStreetAddress(withoutServiceUnit(mapAddress(address))));
  const parsed=serviceHouseAndStreet(full);
  const missingSuffix=omittedHouseSuffix(address,candidate);
  if(!parsed || (candidate.streetOnly ? candidate.house!=='' : !candidate.house||normalizeHouseNumber(parsed.house)!==normalizeHouseNumber(candidate.house) && !missingSuffix))return false;
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
  // With no premises evidence, require the complete road name and ZIP. Only
  // corroborated, bounded street evidence may relax ZIP equality for display.
  if((candidate.streetOnly || missingSuffix) && normalize(mapStreet(tail))!==normalize(mapStreet(candidate.street)))return false;
  if(missingSuffix && sourceZip!==candidate.zip)return false;
  if(candidate.streetOnly && sourceZip!==candidate.zip && !(candidate.streetZipCorroborated
    && /^\d{5}$/.test(sourceZip||'') && /^\d{5}$/.test(candidate.zip)
    && sourceZip!.slice(0,3)===candidate.zip.slice(0,3)))return false;
  return true;
}
function candidateScore(address:string,row:CachedCandidate) {
  const source=normalize(withoutServiceUnit(mapAddress(address)));
  const sourceUnit=mapUnit(address)||omittedHouseSuffix(address,row),unit=mapUnit(row.street);
  const street=normalize(mapStreet(row.street));
  const zip=address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
  // Favor the requested unit; otherwise a premises/entrance pin is more useful
  // than an arbitrary neighboring apartment. Ties use a stable identity below.
  return (row.streetOnly ? 0 : omittedHouseSuffix(address,row) ? 10000 : 20000)
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
  // A directional interpretation cannot choose between distinct premises.
  if(matches.some(row=>compactHighwayMatch(address,row) || relocatedDirectionMatch(address,row))
    &&new Set(matches.map(row=>JSON.stringify([normalizeHouseNumber(row.house),normalize(row.street),row.latitude,row.longitude]))).size>1)return null;
  matches.sort((a,b)=>candidateScore(address,b)-candidateScore(address,a) || identity(a).localeCompare(identity(b)));
  const row=matches[0];
  if(!row)return null;
  const matchedAddress=`${[row.house,row.street].filter(Boolean).join(' ')}, ${row.city}, ${row.state} ${row.zip}`;
  const missingSuffix=omittedHouseSuffix(address,row);
  return {location:{latitude:row.latitude,longitude:row.longitude},matchedAddress,source:row.source,sourceUrl:row.sourceUrl,stale:row.stale,
    visitEligible:false,
    detail:`${row.stale?'Last available map result. ':''}Best available address match. ${row.precision}.${compactHighwayMatch(address,row) ? ' Source house suffix interpreted as a highway direction; property address remains unverified.' : ''}${relocatedDirectionMatch(address,row) ? ' Source post-direction matched to the same provider road direction; property address remains unverified.' : ''}${mapUnit(address) ? ' Unit entrance not located.' : ''}${row.streetZipCorroborated ? ` Source ZIP differs from provider ZIP ${row.zip}; street corroborated by cached Geocodio evidence.` : ''}${missingSuffix ? ` Building location; source address suffix ${missingSuffix} is unconfirmed.` : ''}`};
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
export function readAddressEvidenceFallback(address:string,now=Date.now()):AddressMapFallback|null {
  if(propertyNameSearch(address))return null;
  const root=process.env.OPSCENTER_DATA_DIR||process.env.OPSBOT_DATA_DIR||path.join(process.env.HOME||'','.openclaw/workspace/opsbot/data');
  const reviewed=readReviewedAddressNavigation(address,root,now);
  if(reviewed)return reviewed;
  const candidates:CachedCandidate[]=[];
  const streetEvidence:CachedCandidate[]=[];
  const exactStreetCenters:CachedCandidate[]=[];
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
    const legacy=legacyServiceQuery(fullFieldStreetAddress(lookup));
    const osmQuery=osmMapAddressQuery(lookup);
    for(const cachedQuery of new Set(osmQuery ? [osmQuery,legacy.replace(/[,\s]+\d{5}(?:-\d{4})?\s*$/,'').trim()] : [])) {
      const params=new URLSearchParams({q:cachedQuery,format:'jsonv2',addressdetails:'1',limit:'5',countrycodes:'us'});
      const directory=process.env.OSM_ADDRESS_CACHE_DIR||path.join(root,'cache/osm-address-lookups');
      const cached=cachedFile(path.join(directory,hash('search?'+params)+'.json'));
      if(cacheUsable(cached,now)&&Array.isArray(cached.payload)&&cached.payload.every((row:any)=>row&&typeof row==='object')) {
        const rows:Candidate[]=cached.payload.flatMap((row:any)=>{
          const a=row?.address||{};
          const streetOnly=!a.house_number&&usableOsmStreetPoint(row);
          if(!a.house_number&&!streetOnly)return [];
          const state=String(a['ISO3166-2-lvl4']||'').replace(/^US-/,'')||({Louisiana:'LA',Mississippi:'MS',Florida:'FL'} as Record<string,string>)[a.state]||a.state;
          return [{house:a.house_number||'',street:[a.road,a.unit?`Unit ${a.unit}`:''].filter(Boolean).join(' '),city:a.city||a.town||a.village||'',state:a.country_code==='us'?state:'',zip:String(a.postcode||'').slice(0,5),latitude:row.lat==null?NaN:Number(row.lat),longitude:row.lon==null?NaN:Number(row.lon),source:'OpenStreetMap',sourceUrl:`https://www.openstreetmap.org/${row.osm_type}/${row.osm_id}`,precision:streetOnly?'Approximate street location; house number not located':'Provider map location',streetOnly,bounds:streetOnly?row.boundingbox.map(Number):undefined}];
        });
        candidates.push(...rows.map(row=>({...row,stale:cached.expires<=now})));
      }
    }
    const query=geocodioAddressQuery(lookup);
    const legacyWithState=/\b(?:LA|LOUISIANA)[,\s]+\d{5}/i.test(legacy) ? legacy : legacy.replace(/[,\s]+(\d{5}(?:-\d{4})?)$/,', LA $1');
    for(const cachedQuery of new Set(query ? [query,legacyWithState] : [])) {
      const stateFile=process.env.GEOCODIO_FREE_STATE_FILE||path.join(process.env.HOME||'','Library/Application Support/OpsCenter/geocodio-free-usage.json');
      const ledger=cachedFile(stateFile),cached=ledger?.schema===1?ledger.cache?.[hash(normalize(cachedQuery))]:null;
      if(cacheUsable(cached,now)&&Array.isArray(cached.payload?.results)&&cached.payload.results.every((row:any)=>row&&typeof row==='object')) {
        const rows:Candidate[]=cached.payload.results.map((row:any)=>{
          const a=row?.address_components||{};
          const unit=a.unit_number||a.secondarynumber;
          return {house:a.number||'',street:[a.formatted_street,unit?`Unit ${unit}`:''].filter(Boolean).join(' '),city:a.city||'',state:a.country==='US'?a.state_province:'',zip:String(a.postal_code||'').slice(0,5),latitude:row.location?.lat,longitude:row.location?.lng,source:'Geocodio',sourceUrl:'https://api.geocod.io/v2/geocode',precision:row.accuracy_type==='range_interpolation'?'Estimated position along the street':'Provider map location',confidence:row.accuracy,
            rooftop:row.accuracy===1 && row.accuracy_type==='rooftop' && [null,undefined,'building_centroid','parcel_centroid'].includes(row.match_type) && !unit && !a.unit_type};
        });
        candidates.push(...rows.map(row=>({...row,stale:cached.expires<=now})));
        // A fresh exact street/locality/ZIP center can support approximate
        // navigation even when the requested house is absent. Unrelated fuzzy
        // suggestions do not compete with an exact street identity. Conflicting
        // exact street centers still stay unresolved.
        const centers:CachedCandidate[]=cached.payload.results.flatMap((raw:any,index:number)=>
          raw.accuracy_type==='street_center' && !raw.address_components?.number
            && !raw.address_components?.unit_number && !raw.address_components?.secondarynumber
            && Number.isFinite(raw.accuracy) && raw.accuracy>=0.7 && cached.expires>now
            ? [{...rows[index],streetOnly:true,stale:false,precision:'Approximate street center; house number not located'}] : []);
        const exactCenters=centers.filter(row=>row.state==='LA' && row.latitude>=29 && row.latitude<=31.3
          && row.longitude>=-93 && row.longitude<=-89.4 && mapCandidateMatches(address,row));
        exactStreetCenters.push(...exactCenters);
        // A Geocodio street center with a differing ZIP is corroboration only.
        // It has no house evidence and cannot establish the requested premises.
        streetEvidence.push(...cached.payload.results.flatMap((raw:any,index:number)=>
          cached.payload.results.length===1 && raw.accuracy_type==='street_center' && !raw.address_components?.number
            && !raw.address_components?.unit_number && !raw.address_components?.secondarynumber
            && Number.isFinite(raw.accuracy) && raw.accuracy>=0.5
            ? [{...rows[index],streetOnly:true,stale:cached.expires<=now}] : []));
      }
    }
  }
  // Retain the strict single-provider ZIP rule. A conflicting ZIP may supply
  // a street estimate only when two existing fresh results agree, and just one
  // bounded OSM road matches the complete source street/locality. Never use the
  // dispatch territory as evidence of a property location.
  const roads=candidates.filter(row=>row.streetOnly && !row.stale
    && mapCandidateMatches(address,{...row,streetZipCorroborated:true}));
  if(new Set(roads.map(row=>JSON.stringify([row.sourceUrl,row.latitude,row.longitude,row.zip]))).size===1) {
    for(const road of roads) {
      const bounds=road.bounds;
      if(!bounds || mapCandidateMatches(address,road))continue;
      const corroborated=streetEvidence.some(other=>!other.stale
        && mapCandidateMatches(address,{...other,streetZipCorroborated:true})
        && normalize(other.street)===normalize(road.street)
        && normalize(other.city)===normalize(road.city) && other.state===road.state && other.zip===road.zip
        && other.latitude>=bounds[0] && other.latitude<=bounds[1]
        && other.longitude>=bounds[2] && other.longitude<=bounds[3]
        && gpsDistanceMeters(other,road)<=150);
      if(corroborated)road.streetZipCorroborated=true;
    }
  }
  if(new Set(exactStreetCenters.map(row=>JSON.stringify([normalize(row.street),normalize(row.city),row.zip,row.latitude,row.longitude]))).size===1)
    candidates.push(...exactStreetCenters);
  return bestCandidate(address,candidates);
}
export function readAddressMapFallback(address:string,now=Date.now()):AddressMapFallback|null {
  if(propertyNameSearch(address))return null;
  return readAddressEvidenceFallback(address,now)||zipAreaFallback(address);
}
/** Last resort when no provider evidence matches: the source ZIP's center keeps
 * the map and travel estimates useful. Labeled as a ZIP-area estimate, never
 * visit-eligible, and replaced as soon as any provider or verified match exists. */
export function zipAreaFallback(address:string):AddressMapFallback|null {
  if(serviceStreetCandidates(mapAddress(address)).length!==1)return null;
  const zip=address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
  const center=zip&&Object.hasOwn(ZIP_CENTERS,zip)?ZIP_CENTERS[zip]:null;
  if(!zip||!center)return null;
  return {location:{latitude:center[0],longitude:center[1]},matchedAddress:`ZIP ${zip} area`,source:'ZIP area center',sourceUrl:'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html',stale:false,
    visitEligible:false,zipArea:true,
    detail:`ZIP-area estimate. The street address could not be matched yet, so this is the center of ZIP ${zip}; travel times are rough. Address lookup continues automatically. Not used for arrival or departure detection.`};
}
