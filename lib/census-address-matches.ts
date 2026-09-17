import { serviceHouseAndStreet, normalizeHouseNumber } from './service-house-number';
import { normalizeServiceAddress } from './service-address-format';
export type CensusAddressMatch = {
  matchedAddress?: string;
  addressComponents?: { zip?: string; state?: string; city?: string; streetName?: string; preDirection?: string; preType?: string; suffixDirection?: string; suffixType?: string; suffixQualifier?: string; preQualifier?: string };
  coordinates?: { x?: number; y?: number };
  tigerLine?: { tigerLineId?: string; side?: string };
};

// Census can publish spaced/unspaced aliases as separate results. Collapse only
// when they identify the same address on the same side of the same road segment
// at precisely the same point; nearby points or different streets stay ambiguous.
export function sameCensusAddress(matches: CensusAddressMatch[]): boolean {
  const normalize = (value?: string) => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  const identities = matches.map(match => {
    const c=match.addressComponents, point=match.coordinates, line=match.tigerLine;
    const parsed=serviceHouseAndStreet((match.matchedAddress || '').split(',')[0]);
    const house=parsed && normalizeHouseNumber(parsed.house);
    if (!house || !c?.streetName || !c.city || !c.zip || !c.state || !line?.tigerLineId || !['L','R'].includes(line.side || '') || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    return JSON.stringify([house,normalizeServiceAddress(`0 ${c.streetName} ${c.suffixType || ''}`).replace(/ /g,''),
      normalizeServiceAddress(`0 ${parsed!.street}`).replace(/ /g,''),
      ...[c.preDirection,c.preType,c.suffixDirection,c.suffixType,c.suffixQualifier,c.preQualifier,c.city,c.state,c.zip].map(value => normalizeServiceAddress(normalize(value))),
      line.tigerLineId,line.side,point?.x,point?.y]);
  });
  return identities.length > 1 && identities.every(identity => identity !== null && identity === identities[0]);
}
