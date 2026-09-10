import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { PlanningLocation } from './planning-geocodes';

// Reviewed evidence is runtime data, preserved across releases. Scope each
// correction to the entire original field, including house, locality and ZIP.
export const reviewedAddressIdentity = (address: string) => address.toUpperCase().replace(/\b(?:LA|LOUISIANA)\s+(?=\d{5}\b)/g, '').replace(/[^A-Z0-9#]+/g, ' ').trim();
export function reviewedServiceAddress(address: string): { location: PlanningLocation; reason: string; verifiedAddress: string } | undefined {
  const identity = reviewedAddressIdentity(address);
  const root = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data');
  try {
    const row = JSON.parse(fs.readFileSync(path.join(root, 'cache/service-address-reviews', createHash('sha256').update(identity).digest('hex') + '.json'), 'utf8'));
    const point = row.location;
    if (row.schema !== 1 || row.status !== 'verified' || reviewedAddressIdentity(row.originalAddress) !== identity || !row.verifiedAddress || !Array.isArray(row.sources) || !row.sources.length || !row.sources.every((url: unknown) => typeof url === 'string' && /^https:\/\//.test(url))) return undefined;
    if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || point.latitude < 29 || point.latitude > 31.3 || point.longitude < -93 || point.longitude > -89.4) return undefined;
    return { location: point, reason: 'Address verified against recorded source evidence', verifiedAddress: row.verifiedAddress };
  } catch { return undefined; }
}
