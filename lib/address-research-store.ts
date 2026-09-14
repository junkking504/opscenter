import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readJobRows } from './desktop-schedule-source';
import { planningLocation } from './planning-geocodes';
import { reviewedAddressIdentity } from './reviewed-service-address';
import type { AddressCandidate } from './address-research';
import type { AddressEvidence } from './address-research-evidence';

export const addressDataRoot = () => process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data');
export function addressResearchCandidates(today: string, root = addressDataRoot()): AddressCandidate[] {
  const history = path.join(root, 'history/junkware'), dates = new Set([today]);
  for (const file of fs.readdirSync(history)) {
    const date = file.match(/(\d{4}-\d{2}-\d{2})/)?.[1]; if (date && date >= today) dates.add(date);
  }
  let pins = {};
  try { pins = JSON.parse(fs.readFileSync(path.join(root, 'cache/appointment_geocodes.json'), 'utf8')).addresses || {}; } catch { /* Missing geocodes remain unresolved. */ }
  return [...dates].sort().flatMap(date => readJobRows(date).filter(j => j.address && j.address !== '—' && !/cancel|complete|closed/i.test(j.status))
    .map(j => ({ address: j.address, dates: [date], located: Boolean(planningLocation(j.address, pins)) })));
}

export function publishAddressEvidence(original: string, evidence: AddressEvidence, root = addressDataRoot()) {
  const point = evidence.location;
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || point.latitude < 29 || point.latitude > 31.3
    || point.longitude < -93 || point.longitude > -89.4 || !evidence.sources.length || evidence.sources.some(s => !/^https:\/\//.test(s))) throw new Error('Address evidence is incomplete');
  const id = createHash('sha256').update(reviewedAddressIdentity(original)).digest('hex');
  const directory = path.join(root, 'cache/service-address-reviews'), file = path.join(directory, id + '.json');
  fs.mkdirSync(directory, {recursive: true});
  const verifyExisting = () => {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.schema !== 1 || saved.status !== 'verified' || reviewedAddressIdentity(saved.originalAddress || '') !== reviewedAddressIdentity(original)
      || saved.location?.latitude !== point.latitude || saved.location?.longitude !== point.longitude
      || !Array.isArray(saved.sources) || !saved.sources.length || !saved.sources.every((source: unknown) => typeof source === 'string' && /^https:\/\//.test(source))) {
      throw new Error('Existing address evidence conflicts or needs review');
    }
  };
  if (fs.existsSync(file)) { verifyExisting(); return; }
  const record = { schema: 1, status: 'verified', originalAddress: original, verifiedAddress: evidence.matchedAddress || original,
    location: point, sources: evidence.sources, reason: evidence.reason, precision: evidence.precision || 'verified-service-premises',
    source: evidence.source || 'Independent address verifier', verifiedAt: new Date().toISOString(), actor: 'address-investigation-worker' };
  const temporary = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx', 0o660);
  try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    // Atomic create-if-absent: another writer cannot be overwritten between
    // checking existing evidence and publication. Corrections require review.
    try { fs.linkSync(temporary, file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    verifyExisting();
  } finally { fs.unlinkSync(temporary); }
}
