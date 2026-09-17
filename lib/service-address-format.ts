import { normalizeStreetOrdinal } from './street-ordinal';
// Formatting aliases do not change the house, road number, direction or locality.
const aliases: Record<string,string> = { STREET:'ST',ROAD:'RD',AVENUE:'AVE',AV:'AVE',DRIVE:'DR',LANE:'LN',COURT:'CT',BOULEVARD:'BLVD',HIGHWAY:'HWY',PLACE:'PL',PARKWAY:'PKWY',PKY:'PKWY',TERRACE:'TER',CIRCLE:'CIR',TRAIL:'TRL',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',SAINT:'ST',NORTHEAST:'NE',NORTHWEST:'NW',SOUTHEAST:'SE',SOUTHWEST:'SW' };
export const normalizeServiceAddress = (text: string) => normalizeStreetOrdinal(text.toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).map(word=>aliases[word]||word).join(' ')
  .replace(/\b(?:LOUISIANA|LA|STATE) (?:HWY|ROUTE|RTE|RT) (\d+)\b/g,'LA $1'));
const units = /(?:\b(?:suite|ste|unit|apt|apartment|floor|fl|building|bldg)\.?(?:\s*#\s*|\s+)|(?<![A-Z0-9])#\s*)[A-Z0-9]+(?:-[A-Z0-9]+)*\b\s*,?\s*/ig;
export const withoutServiceUnit = (address: string) => address.replace(units,' ').replace(/\s+/g,' ').trim();
export function cleanServiceQuery(address: string) {
  let value = withoutServiceUnit(address).replace(/\bPky\b/ig,'Pkwy').replace(/\bLA\s*-\s*(\d+)\b/ig,'LA Highway $1').replace(/\s*,\s*/g,', ');
  // A separate JunkWare city/ZIP can repeat an already complete address.
  value = value.replace(/,\s*([A-Za-z .'-]+),?\s+(LA|Louisiana)\s+(\d{5})\s+\1,?\s+\2\s+\3$/i,', $1, $2 $3');
  return value.trim();
}
export function appointmentServiceAddress(job: {address:string;mapAddress?:string}) {
  if (!job.mapAddress) return job.address;
  const sourceUnits = job.address.match(units)?.map(unit=>unit.replace(/[,\s]+$/,'').trim()) || [];
  if (!sourceUnits.length) return job.mapAddress;
  // Source units remain the crew instruction even if the provider omits them
  // or returns a conflicting unit. Never replace Apt 2 with Apt 20.
  const mapped = job.mapAddress.replace(units, unit => /,\s*$/.test(unit) ? ', ' : ' ').replace(/(?:,\s*){2,}/g, ', ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
  const comma = mapped.indexOf(',');
  return comma < 0 ? `${mapped}, ${sourceUnits.join(', ')}` : `${mapped.slice(0,comma)}, ${sourceUnits.join(', ')},${mapped.slice(comma+1)}`;
}
