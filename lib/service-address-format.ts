import { normalizeStreetOrdinal } from './street-ordinal';
import { cleanServiceAddressForVerification } from './junkware-address-text';
// Formatting aliases do not change the house, road number, direction or locality.
const aliases: Record<string,string> = { STREET:'ST',STR:'ST',ROAD:'RD',AVENUE:'AVE',AV:'AVE',DRIVE:'DR',LANE:'LN',COURT:'CT',BOULEVARD:'BLVD',HIGHWAY:'HWY',PLACE:'PL',PARKWAY:'PKWY',PKY:'PKWY',TERRACE:'TER',CIRCLE:'CIR',TRAIL:'TRL',SQUARE:'SQ',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',SAINT:'ST',NORTHEAST:'NE',NORTHWEST:'NW',SOUTHEAST:'SE',SOUTHWEST:'SW' };
export const normalizeServiceAddress = (text: string) => normalizeStreetOrdinal(text.toUpperCase().replace(/\bLP\b/g,'LOOP').replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).map(word=>aliases[word]||word).join(' ')
  .replace(/\b(?:LOUISIANA|LA|STATE) (?:HWY|ROUTE|RTE|RT) (\d+)\b/g,'LA $1')
  // Louisiana parish/provider records commonly spell a source "Highway 59"
  // as "State Highway 59". Treat those as the same numbered state route, but
  // retain an explicit US designation so US Highway 59 cannot become LA 59.
  .replace(/(?<!\bUS )\bHWY (\d+)\b/g,'LA $1'));
const units = /(?:\b(?:suite|ste|unit|apt|apartment|floor|fl|building|bldg)\.?(?:\s*#\s*|\s+)|(?<![A-Z0-9])#\s*)[A-Z0-9]+(?:-[A-Z0-9]+)*\b\s*,?\s*/ig;
// A bare alphanumeric unit is recognized only after a road suffix and before
// a complete locality/ZIP tail. Never consume highway identifiers or numbers.
const bareUnit = /(\b(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|boulevard|blvd|place|pl|parkway|pkwy|terrace|ter|circle|cir|trail|trl)\.?)[,\s]+([A-Z]{1,2}\d{1,4}[A-Z]?)(?=[,\s]+[A-Z][A-Z .'-]*,?\s+(?:(?:LA|LOUISIANA)[,\s]+)?\d{5}(?:-\d{4})?\s*$)/ig;
const explicitServiceUnits = (address: string) => address.replace(bareUnit,(match, suffix: string, unit: string, offset: number) =>
  /\b(?:county|parish|state|farm)\s*$/i.test(address.slice(0,offset)) ? match : `${suffix} Unit ${unit}`);
export const withoutServiceUnit = (address: string) => explicitServiceUnits(address).replace(units,' ').replace(/\s+/g,' ').trim();
export function cleanServiceQuery(address: string) {
  const value = withoutServiceUnit(cleanServiceAddressForVerification(address)).replace(/\bStr\b/ig,'Street').replace(/\bPky\b/ig,'Pkwy').replace(/\bLA\s*-\s*(\d+)\b/ig,'LA Highway $1').replace(/\s*,\s*/g,', ');
  return value.trim();
}
export function appointmentServiceAddress(job: {address:string;mapAddress?:string}) {
  if (!job.mapAddress) return job.address;
  const sourceUnits = explicitServiceUnits(job.address).match(units)?.map(unit=>unit.replace(/[,\s]+$/,'').trim()) || [];
  if (!sourceUnits.length) return job.mapAddress;
  // Source units remain the crew instruction even if the provider omits them
  // or returns a conflicting unit. Never replace Apt 2 with Apt 20.
  const mapped = explicitServiceUnits(job.mapAddress).replace(units, unit => /,\s*$/.test(unit) ? ', ' : ' ').replace(/(?:,\s*){2,}/g, ', ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
  const comma = mapped.indexOf(',');
  return comma < 0 ? `${mapped}, ${sourceUnits.join(', ')}` : `${mapped.slice(0,comma)}, ${sourceUnits.join(', ')},${mapped.slice(comma+1)}`;
}
