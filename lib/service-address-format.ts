import { normalizeStreetOrdinal } from './street-ordinal';
import { cleanServiceAddressForVerification } from './junkware-address-text';
import { firstHouseAndStreet } from './service-house-number';
// Formatting aliases do not change the house, road number, direction or locality.
const aliases: Record<string,string> = { STREET:'ST',STR:'ST',ROAD:'RD',AVENUE:'AVE',AV:'AVE',DRIVE:'DR',LANE:'LN',COURT:'CT',BOULEVARD:'BLVD',HIGHWAY:'HWY',PLACE:'PL',PARKWAY:'PKWY',PKY:'PKWY',TERRACE:'TER',CIRCLE:'CIR',TRAIL:'TRL',TRACE:'TRCE',SQUARE:'SQ',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',SAINT:'ST',NORTHEAST:'NE',NORTHWEST:'NW',SOUTHEAST:'SE',SOUTHWEST:'SW' };
export const normalizeServiceAddress = (text: string) => normalizeStreetOrdinal(text.toUpperCase().replace(/(?<=[A-Z])['’‘ʼ](?=[A-Z])/g,'').replace(/\bLP\b/g,'LOOP').replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).map(word=>aliases[word]||word).join(' ')
  .replace(/\bINTERSTATE (\d+)\b/g,'I $1')
  .replace(/\b(?:LOUISIANA|LA|STATE) (?:HWY|ROUTE|RTE|RT) (\d+)\b/g,'LA $1')
  // Louisiana parish/provider records commonly spell a source "Highway 59"
  // as "State Highway 59". Treat those as the same numbered state route, but
  // retain an explicit US designation so US Highway 59 cannot become LA 59.
  .replace(/(?<!\bUS )\bHWY (\d+)\b/g,'LA $1'));
const legacyUnits = /(?:\b(?:suite|ste|unit|apt|apartment|floor|fl|building|bldg)\.?(?:\s*#\s*|\s+)|(?<![A-Z0-9])#\s*)[A-Z0-9]+(?:-[A-Z0-9]+)*\b\s*,?\s*/ig;
const units = /(?:\b(?:suite|ste|unit|apt|apartment|floor|fl|building|bldg|lot|trailer|trlr|space)\.?(?:\s*#\s*|\s+)|(?<![A-Z0-9])#\s*)[A-Z0-9]+(?:-[A-Z0-9]+)*\b\s*,?\s*/ig;
// A bare alphanumeric unit is recognized only after a road suffix and before
// a complete locality/ZIP tail. Never consume highway identifiers or numbers.
const bareUnit = /(\b(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|boulevard|blvd|place|pl|parkway|pkwy|terrace|ter|circle|cir|trail|trl)\.?)[,\s]+([A-Z]{1,2}\d{1,4}[A-Z]?|[A-Z])(?=[,\s]+[A-Z][A-Z .'-]*,?\s+(?:(?:LA|LOUISIANA)[,\s]+)?\d{5}(?:-\d{4})?\s*$)/ig;
const explicitServiceUnits = (address: string, bareLetters = true) => address.replace(bareUnit,(match, suffix: string, unit: string, offset: number) => {
  const prefix = address.slice(0,offset);
  if (/\b(?:county|parish|state|farm)\s*$/i.test(prefix)) return match;
  if (unit.length === 1) {
    // A post-direction is not a unit; "Avenue B" is a street name. Require
    // a house plus a real street name before the suffix, not just a direction.
    const street = firstHouseAndStreet(prefix)?.street;
    if (!bareLetters || /^[NSEW]$/i.test(unit) || !street
      || /^(?:N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST|NORTHEAST|NORTHWEST|SOUTHEAST|SOUTHWEST)$/i.test(street.trim())) return match;
  }
  return `${suffix} Unit ${unit}`;
});
const roadEnd = /\b(?:street|st|str|road|rd|avenue|ave|av|drive|dr|lane|ln|court|ct|boulevard|blvd|place|pl|parkway|pkwy|pky|terrace|ter|circle|cir|trail|trl|trace|trce|square|sq|way|loop)\.?[,\s]*$/i;
function recognizedUnit(address:string,unit:string,index:number) {
  // These labels also occur in road names (Space Walk, Trailer Park Rd).
  // Admit them only after a complete street, optionally following other units.
  return !/^(?:lot|trailer|trlr|space)\b/i.test(unit)
    || roadEnd.test(address.slice(0,index).replace(new RegExp(units),' ').trim());
}
function replaceServiceUnits(address:string,replacement:(unit:string)=>string) {
  const value=explicitServiceUnits(address);
  return value.replace(units,(unit:string,index:number)=>recognizedUnit(value,unit,index)?replacement(unit):unit);
}
// Only collapse adjacent repeated locality text after a complete road suffix
// and before the postal tail. Never deduplicate street words or single-letter roads.
export function normalizeRepeatedServiceLocality(address: string) {
  return address.replace(/(\b(?:street|st|str|road|rd|avenue|ave|av|drive|dr|lane|ln|court|ct|boulevard|blvd|place|pl|parkway|pkwy|pky|terrace|ter|circle|cir|trail|trl|trace|trce|square|sq|way|loop)\.?)[,\s]+([A-Z][A-Z .'-]*?)(?:[,\s]+\2)+(?=,?\s+(?:(?:LA|LOUISIANA)[,\s]+)?\d{5}(?:-\d{4})?\s*$)/i,'$1 $2');
}
export function serviceUnitIdentifiers(address: string) {
  const value=explicitServiceUnits(address);
  return [...value.matchAll(units)].filter(match=>recognizedUnit(value,match[0],match.index!)).map(match => match[0]
    .replace(/^(?:suite|ste|unit|apt|apartment|floor|fl|building|bldg|lot|trailer|trlr|space)\.?\s*/i,'')
    .replace(/^[#\s]+/,'').replace(/[,\s]+$/,'').toUpperCase().replace(/-/g,''));
}
export const withoutServiceUnit = (address: string) => normalizeRepeatedServiceLocality(replaceServiceUnits(address,()=> ' ').replace(/\s+/g,' ').trim());
const queryFormatting = (address: string) => address.replace(/\bStr\b/ig,'Street').replace(/\bPky\b/ig,'Pkwy').replace(/\bLA\s*-\s*(\d+)\b/ig,'LA Highway $1').replace(/\s*,\s*/g,', ').trim();
// Read pre-normalization provider cache keys without making another lookup.
export function legacyServiceQuery(address: string) {
  return queryFormatting(explicitServiceUnits(cleanServiceAddressForVerification(address),false).replace(legacyUnits,' ').replace(/\s+/g,' ').trim());
}
export function cleanServiceQuery(address: string) {
  const value = queryFormatting(withoutServiceUnit(cleanServiceAddressForVerification(address)));
  return value.trim();
}
export function appointmentServiceAddress(job: {address:string;mapAddress?:string}) {
  if (!job.mapAddress) return job.address;
  const sourceUnits:string[]=[];
  replaceServiceUnits(job.address,unit=>{sourceUnits.push(unit.replace(/[,\s]+$/,'').trim());return unit;});
  if (!sourceUnits.length) return job.mapAddress;
  // Source units remain the crew instruction even if the provider omits them
  // or returns a conflicting unit. Never replace Apt 2 with Apt 20.
  const mapped = replaceServiceUnits(job.mapAddress, unit => /,\s*$/.test(unit) ? ', ' : ' ').replace(/(?:,\s*){2,}/g, ', ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
  const comma = mapped.indexOf(',');
  return comma < 0 ? `${mapped}, ${sourceUnits.join(', ')}` : `${mapped.slice(0,comma)}, ${sourceUnits.join(', ')},${mapped.slice(comma+1)}`;
}
