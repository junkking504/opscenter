// Called by the existing serialized minute refresh; no browser interaction is
// needed. New/changed addresses enter automatically on the next source sweep.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readVerifiedJunkwareScheduleSnapshot } from '../lib/junkware-fast-schedule';
import { readJobRows } from '../lib/desktop-schedule-source';
import { ADDRESS_VERIFICATION_POLICY, verifyDesktopAddress, cachedAddressVerification } from '../lib/desktop-address-verification';
import { planningLocation } from '../lib/planning-geocodes';

const root = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data');
const target = process.argv[2];
const retryIntervalMs = 5 * 60_000;
if (!/^\d{4}-\d{2}-\d{2}$/.test(target || '')) throw new Error('Service date required');
const read = (file: string) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const write = (file: string, value: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = file + '.' + randomUUID() + '.tmp'; fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o660 }); fs.renameSync(temp, file); };
const normalize = (address: string) => address.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim().toUpperCase();
const hash = (address: string) => createHash('sha256').update(normalize(address)).digest('hex');
async function main() {
  const snapshot = readVerifiedJunkwareScheduleSnapshot(root, target);
  const supplemental = path.join(root, 'history/linxup/junkware_appointment_sources', `junkware_appointments_${target}.json`);
  const prior = read(supplemental);
  if (snapshot && snapshot.freshnessAtMs > Date.now() - 10 * 60_000 && snapshot.updatedAtMs > Date.parse(prior.scraped_at || prior.collection_timestamp || '1970-01-01')) {
    write(supplemental, { date: target, scraped_at: snapshot.scrapedAt, collection_timestamp: snapshot.updatedAt, appointments: snapshot.appointments, cancelled: snapshot.cancelled, verification: { verified_date: target, all_territories_verified: true }, source: 'verified_current_schedule' });
  }
  const geocodeFile = path.join(root, 'cache/appointment_geocodes.json');
  const geocodes = read(geocodeFile).addresses || {};
  const stateFile = path.join(root, 'cache/schedule-address-refresh.json');
  const state = read(stateFile);
  const attempts = state.policyVersion === ADDRESS_VERIFICATION_POLICY ? state.attempts || {} : {};
  // Include every collected schedule date, not only whichever page is open.
  const history = path.join(root, 'history/junkware');
  const dates = new Set<string>([target]);
  for (const file of fs.existsSync(history) ? fs.readdirSync(history) : []) {
    const date = file.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
    if (date && date >= target) dates.add(date);
  }
  const missingAddresses = new Set<string>();
  const addresses = [...new Set([...dates].sort().flatMap(date => {
    const source = readVerifiedJunkwareScheduleSnapshot(root, date);
    const rows = [...readJobRows(date), ...(source?.appointments || []), ...(source?.cancelled || [])];
    return rows.flatMap((row, index) => {
      const address = String(row.address || '').trim();
      if (!address || address === '—' || /^address unavailable$/i.test(address)) {
        missingAddresses.add(`${date}:${row.appointmentId || ('appt_id' in row ? row.appt_id : '') || index}`);
        return [];
      }
      return [address];
    });
  }))];
  // Reviewed corrections must also reach the independently consumed visit
  // cache, even when an older collector still holds a conflicting entry.
  for (const address of addresses) {
    const reviewed = cachedAddressVerification(address);
    if (!reviewed?.location) continue;
    const old = geocodes[hash(address)];
    if (old?.latitude === reviewed.location.latitude && old?.longitude === reviewed.location.longitude && old?.house_street_verified && old?.verification_policy === ADDRESS_VERIFICATION_POLICY) continue;
    const cache = read(geocodeFile);
    cache.addresses = { ...cache.addresses, [hash(address)]: { ...reviewed.location, normalized_address: normalize(address), match_confidence: 'confirmed', house_street_verified: true, verification_policy: ADDRESS_VERIFICATION_POLICY, matched_address: reviewed.matchedAddress, geocoder_source: 'Shared full-address verifier', reason: reviewed.reason, collection_timestamp: new Date().toISOString() } };
    write(geocodeFile, cache);
    geocodes[hash(address)] = cache.addresses[hash(address)];
  }
  const candidates = addresses.filter(address => !planningLocation(address, geocodes) && Date.now() - Number(attempts[hash(address)] || 0) >= retryIntervalMs)
    .sort((a, b) => Number(attempts[hash(a)] || 0) - Number(attempts[hash(b)] || 0)).slice(0, 4);
  let verified = 0;
  for (const address of candidates) {
    const result = cachedAddressVerification(address) || await verifyDesktopAddress(address);
    attempts[hash(address)] = result.retryAfterMs ? Date.now() - retryIntervalMs + result.retryAfterMs : Date.now();
    if (result.location) {
      // Reload immediately before the atomic write to preserve other entries.
      const cache = read(geocodeFile);
      cache.addresses = { ...cache.addresses, [hash(address)]: { ...result.location, normalized_address: normalize(address), match_confidence: 'confirmed', house_street_verified: true, verification_policy: ADDRESS_VERIFICATION_POLICY, matched_address: result.matchedAddress, geocoder_source: 'Shared full-address verifier', reason: result.reason, collection_timestamp: new Date().toISOString() } };
      write(geocodeFile, cache); verified++;
    }
  }
  const finalGeocodes = read(geocodeFile).addresses || {};
  const unresolved = addresses.filter(address => !planningLocation(address, finalGeocodes));
  write(stateFile, { coverage: { addresses: addresses.length, mapped: addresses.length - unresolved.length, unresolved: unresolved.length, missing: missingAddresses.size, complete: unresolved.length === 0 && missingAddresses.size === 0 }, unresolvedAddresses: unresolved, missingAddressAppointments: [...missingAddresses], policyVersion: ADDRESS_VERIFICATION_POLICY, observedAt: new Date().toISOString(), checked: candidates.length, verified, scheduleDates: dates.size, attempts });
  console.log(`Schedule map refresh: ${dates.size} dates, ${candidates.length} address checks, ${verified} verified; ${addresses.length - unresolved.length}/${addresses.length} mapped, ${unresolved.length} unresolved.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Schedule map refresh failed'); process.exitCode = 1; });
