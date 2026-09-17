// Formatting aliases do not change the house, road number, direction or locality.
const aliases: Record<string,string> = { STREET:'ST',ROAD:'RD',AVENUE:'AVE',AV:'AVE',DRIVE:'DR',LANE:'LN',COURT:'CT',BOULEVARD:'BLVD',HIGHWAY:'HWY',PLACE:'PL',PARKWAY:'PKWY',PKY:'PKWY',TERRACE:'TER',CIRCLE:'CIR',TRAIL:'TRL',NORTH:'N',SOUTH:'S',EAST:'E',WEST:'W',SAINT:'ST' };
// Written ordinals are equivalent only in a numbered street expression. Do
// not rewrite business names, units, localities or longer named roads.
const ordinalWords = ['FIRST','SECOND','THIRD','FOURTH','FIFTH','SIXTH','SEVENTH','EIGHTH','NINTH','TENTH','ELEVENTH','TWELFTH','THIRTEENTH','FOURTEENTH','FIFTEENTH','SIXTEENTH','SEVENTEENTH','EIGHTEENTH','NINETEENTH'];
const ordinalStreets: Record<string,string> = {};
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ({1:'ST',2:'ND',3:'RD'} as Record<number,string>)[n % 10] || 'TH'}`;
ordinalWords.forEach((word, index) => { ordinalStreets[word] = ordinal(index + 1); });
['TWENTY','THIRTY','FORTY','FIFTY','SIXTY','SEVENTY','EIGHTY','NINETY'].forEach((tens, index) => {
  const n = (index + 2) * 10;
  ordinalStreets[tens.replace(/Y$/, 'IETH')] = ordinal(n);
  ordinalWords.slice(0, 9).forEach((word, unit) => { ordinalStreets[`${tens} ${word}`] = ordinal(n + unit + 1); });
});
const numberedStreet = new RegExp(`\\b(\\d+[A-Z]? (?:N |S |E |W |NE |NW |SE |SW )?)(${Object.keys(ordinalStreets).join('|')})(?= (?:ST|RD|AVE|DR|LN|CT|BLVD|HWY|PL|PKWY|TER|CIR|TRL|WAY)\\b)`, 'g');
export const normalizeServiceAddress = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(/\s+/).map(word=>aliases[word]||word).join(' ')
  .replace(numberedStreet, (_, houseAndDirection: string, street: string) => houseAndDirection + ordinalStreets[street])
  .replace(/\b(?:LOUISIANA|LA|STATE) (?:HWY|ROUTE|RTE|RT) (\d+)\b/g,'LA $1');
const units = /\b(?:suite|ste|unit|apt|apartment|floor|fl|building|bldg)\.?\s+[A-Z0-9-]+\b\s*,?\s*/ig;
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
  const missing = sourceUnits.filter(unit=>!normalizeServiceAddress(job.mapAddress!).includes(normalizeServiceAddress(unit)));
  if (!missing.length) return job.mapAddress;
  const comma=job.mapAddress.indexOf(',');
  return comma<0 ? `${job.mapAddress}, ${missing.join(', ')}` : `${job.mapAddress.slice(0,comma)}, ${missing.join(', ')},${job.mapAddress.slice(comma+1)}`;
}
