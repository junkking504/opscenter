import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fullFieldStreetAddress, serviceStreetCandidates } from './appointment-partner';
import { cleanJunkwareAddressText } from './junkware-address-text';
import { normalizeServiceAddress, withoutServiceUnit } from './service-address-format';
import type { AddressVerification } from './desktop-address-verification';

const endpoint = 'https://maps.brla.gov/gis/rest/services/Map_Reference/Street_Address/MapServer/0/query';
const unavailable = (): AddressVerification => ({ location: null, reason: 'No Exact Parish Address Match' });
const normalize = normalizeServiceAddress;

export function parishAddressQuery(address: string) {
  address = cleanJunkwareAddressText(address);
  if (serviceStreetCandidates(address).length !== 1) return null;
  const full = fullFieldStreetAddress(address);
  const match = withoutServiceUnit(full).match(/^(\d{1,7})\s+(.+?)[,\s]+(BATON ROUGE|ZACHARY|BAKER|CENTRAL),?\s+(?:LA|LOUISIANA)[,\s]+(\d{5})(?:-\d{4})?$/i);
  if (!match || !/^[A-Z][A-Z0-9 .'-]*$/i.test(match[2])) return null;
  const buildings = [...full.matchAll(/\b(?:BLDG|BUILDING)\.?\s*#?\s*([A-Z0-9-]+)\b/gi)];
  if (buildings.length > 1) return null;
  const street = `${match[1]} ${match[2].replace(/[,\s]+$/, '')}`;
  const city = match[3].toUpperCase(), zip = match[4];
  // Apartments do not identify a building. With an explicit building, require
  // that exact building; otherwise require the parish's unsuffixed base point.
  const expected = normalize(street + (buildings.length ? ` BLDG ${buildings[0][1]}` : ''));
  const params = new URLSearchParams({ where: `ADDRESS_NO = ${Number(match[1])} AND CITY = '${city}'`,
    outFields: 'ID,ADDRESS_ID,FULL_ADDRESS,CITY,STATE,ZIP,ADDRESS_AUTHORITY',
    returnGeometry: 'true', outSR: '4326', resultRecordCount: '100', f: 'json' });
  return { expected, city, zip, url: `${endpoint}?${params}` };
}

type Feature = { attributes?: Record<string, unknown>; geometry?: { x?: number; y?: number } };
export function verifyParishAddress(address: string, payload: unknown): AddressVerification {
  const query = parishAddressQuery(address);
  const data = payload as { features?: Feature[]; exceededTransferLimit?: boolean; spatialReference?: { wkid?: number } } | null;
  if (!query || !Array.isArray(data?.features) || data.exceededTransferLimit || data.spatialReference?.wkid !== 4326) return unavailable();
  const candidates = data.features.filter(row => row?.attributes && normalize(String(row.attributes.FULL_ADDRESS || '')) === query.expected);
  if (!candidates.length) return unavailable();
  const points = new Set<string>();
  for (const row of candidates) {
    const a = row.attributes!, g = row.geometry;
    if (a.CITY !== query.city || a.STATE !== 'LA' || String(a.ZIP) !== query.zip || a.ADDRESS_AUTHORITY !== 'PARISH'
      || !Number.isInteger(a.ADDRESS_ID) || !g || !Number.isFinite(g.x) || !Number.isFinite(g.y)
      || g.y! < 30 || g.y! > 31 || g.x! < -91.5 || g.x! > -90.5) return unavailable();
    points.add(JSON.stringify([a.ADDRESS_ID, g.x, g.y]));
  }
  if (points.size !== 1) return { location: null, reason: 'Conflicting Parish Address Points' };
  const row = candidates[0];
  return { location: { latitude: row.geometry!.y!, longitude: row.geometry!.x! },
    matchedAddress: `${row.attributes!.FULL_ADDRESS}, ${query.city}, LA ${query.zip}`,
    reason: 'Exact Parish Service Premises Verified; Unit Entrance Not Located',
    source: 'East Baton Rouge Parish GIS', sourceUrl: query.url };
}

// Shared across browser/server/collector processes: at most one start per
// minute, 8-second timeout, durable query cache and no AI/budget dependency.
export async function verifyParishAddressFallback(address: string): Promise<AddressVerification> {
  const query = parishAddressQuery(address);
  if (!query) return unavailable();
  const root = path.join(process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data'), 'cache/parish-address-lookups');
  const file = path.join(root, createHash('sha256').update(query.url).digest('hex') + '.json');
  const now = Date.now(), slot = Math.floor(now / 60_000);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cached.expires > now) return cached.failed ? { ...unavailable(), retryAfterMs: cached.expires - now } : verifyParishAddress(address, cached.payload);
  } catch { /* Missing or invalid evidence must be obtained again. */ }
  const deferred = { ...unavailable(), retryAfterMs: 60_000 - now % 60_000 + 100 };
  // Keep starts away from the slot boundary; starts are at least 15s apart.
  if (now % 60_000 >= 45_000) return deferred;
  try {
    const reservations = path.join(root, 'reservations');
    fs.mkdirSync(reservations, { recursive: true });
    fs.mkdirSync(path.join(reservations, String(slot)));
    for (const old of fs.readdirSync(reservations)) if (/^\d+$/.test(old) && Number(old) < slot - 6) {
      try { fs.rmdirSync(path.join(reservations, old)); } catch { /* Concurrent pruning is harmless. */ }
    }
  } catch { return deferred; }
  let payload: unknown = null, failed = false;
  try {
    const response = await fetch(query.url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'JunkKing-OpsCenter/1.0 (https://ops.junk-king.app)' } });
    if (!response.ok) throw new Error('Parish lookup unavailable');
    payload = await response.json();
    if (!Array.isArray((payload as { features?: unknown })?.features)) throw new Error('Invalid parish response');
  } catch { failed = true; }
  const result = verifyParishAddress(address, payload);
  const ttl = failed ? 60_000 : result.location ? 7 * 86400_000 : 6 * 3600_000;
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify({ expires: Date.now() + ttl, payload, failed }), { mode: 0o660 });
    fs.renameSync(temporary, file);
  } catch { try { fs.unlinkSync(temporary); } catch { /* The verified response is still usable. */ } }
  return failed ? { ...result, reason: 'Parish Address Provider Temporarily Unavailable', retryAfterMs: 60_000 } : result;
}
