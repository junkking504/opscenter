import { fullFieldStreetAddress, serviceStreetCandidates } from './appointment-partner';
import { verifyDesktopAddress, type AddressVerification } from './desktop-address-verification';
import type { AddressProposal } from './address-research-provider';
import { readOfficialAddressEvidence } from './address-research-source';

const aliases: Record<string,string> = { STREET:'ST', ROAD:'RD', AVENUE:'AVE', DRIVE:'DR', LANE:'LN', COURT:'CT', BOULEVARD:'BLVD', HIGHWAY:'HWY', PARKWAY:'PKWY', PLACE:'PL', CIRCLE:'CIR', TERRACE:'TER', NORTH:'N', SOUTH:'S', EAST:'E', WEST:'W', LOUISIANA:'LA' };
export function researchAddressIdentity(address: string): string | null {
  if (serviceStreetCandidates(address).length !== 1 || !/\b\d{5}(?:-\d{4})?\s*$/.test(address)) return null;
  return fullFieldStreetAddress(address).toUpperCase()
    .replace(/\b(?:SUITE|STE|UNIT|APT|APARTMENT|FLOOR|FL)\.?\s*#?\s*[A-Z0-9-]+\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).map(s => aliases[s] || s).join(' ')
    // A bare unit immediately after a road type is source formatting, not a
    // second street number. Match premises only; never claim an exact entrance.
    .replace(/\b(ST|RD|AVE|DR|LN|CT|BLVD|HWY|PKWY|PL|CIR|TER) \d{1,4}(?= [A-Z])/g, '$1')
    .replace(/ LA (?=\d{5}(?: \d{4})?$)/, ' ').replace(/ (\d{5}) \d{4}$/, ' $1');
}

export type AddressEvidence = AddressVerification & { sources: string[]; precision?: string };
// Research can find a better query but cannot change the service premises.
// House/street/locality/ZIP changes need additional proof, not model confidence.
export async function validateAddressProposal(original: string, proposal: AddressProposal,
  lookup: typeof verifyDesktopAddress = verifyDesktopAddress,
  sourceLookup = readOfficialAddressEvidence): Promise<AddressEvidence> {
  const identity = researchAddressIdentity(original);
  if (!identity || !proposal.candidateAddress || identity !== researchAddressIdentity(proposal.candidateAddress)) {
    return { location: null, reason: 'Research did not establish the same service premises', sources: proposal.sources };
  }
  const verified = await lookup(proposal.candidateAddress);
  if (!verified.location) {
    const published: AddressEvidence[] = [];
    for (const source of proposal.sources.slice(0,2)) {
      const evidence = await sourceLookup(original, source);
      if (evidence?.location) published.push(evidence);
    }
    const unique = new Map(published.map(e => [`${e.location!.latitude},${e.location!.longitude}`, e]));
    if (unique.size === 1) return { ...published[0], sources: [...new Set(published.flatMap(e => e.sources))] };
    if (unique.size > 1) return { location: null, reason: 'Official sources disagree on the service location', sources: proposal.sources };
  }
  return { ...verified, sources: [...new Set([...proposal.sources, ...(verified.sourceUrl ? [verified.sourceUrl] : [])])], precision: 'verified-service-premises' };
}
