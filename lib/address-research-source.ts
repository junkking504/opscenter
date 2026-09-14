import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { researchAddressIdentity, type AddressEvidence } from './address-research-evidence';

export function officialAddressSource(value: string): URL | null {
  try {
    const url = new URL(value), host = url.hostname;
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
      || !(host.endsWith('.gov') || host === 'fmolhs.org' || host.endsWith('.fmolhs.org'))) return null;
    return url;
  } catch { return null; }
}

// Coordinates must be published beside the full postal address on an official
// government/facility page. Model coordinates, map centers and arbitrary HTML
// numbers never enter this validator.
export function publishedAddressEvidence(address: string, html: string, source: string): AddressEvidence | null {
  if (!officialAddressSource(source) || html.length > 300_000) return null;
  const identity = researchAddressIdentity(address);
  if (!identity) return null;
  const found: AddressEvidence[] = [];
  let remaining = 1000;
  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 20 || remaining-- <= 0) return;
    if (Array.isArray(value)) { value.forEach(v => visit(v, depth + 1)); return; }
    const row = value as Record<string, unknown>, a = row.address as Record<string, unknown> | undefined, g = row.geo as Record<string, unknown> | undefined;
    const types = Array.isArray(row['@type']) ? row['@type'] : [row['@type']];
    const premises = types.some(t => typeof t === 'string' && /^(?:Place|LocalBusiness|MedicalClinic|MedicalBusiness|Hospital|Physician|Residence|CivicStructure|GovernmentOffice)$/.test(t));
    if (premises && a && g && typeof a === 'object' && typeof g === 'object'
      && ['streetAddress','addressLocality','addressRegion','postalCode'].every(k => typeof a[k] === 'string')
      && ['LA','Louisiana'].includes(String(a.addressRegion)) && /^(US|USA|United States|United States of America)$/.test(String(a.addressCountry || 'US'))) {
      const matchedAddress = `${a.streetAddress}, ${a.addressLocality}, LA ${a.postalCode}`;
      const latitude = typeof g.latitude === 'number' || typeof g.latitude === 'string' && g.latitude.trim() ? Number(g.latitude) : NaN;
      const longitude = typeof g.longitude === 'number' || typeof g.longitude === 'string' && g.longitude.trim() ? Number(g.longitude) : NaN;
      if (researchAddressIdentity(matchedAddress) === identity && Number.isFinite(latitude) && Number.isFinite(longitude)
        && latitude >= 29 && latitude <= 31.3 && longitude >= -93 && longitude <= -89.4) {
        found.push({ location: { latitude, longitude }, matchedAddress, reason: 'Exact premises and coordinates published by the official source',
          sources: [source], sourceUrl: source, source: 'Official published premises', precision: 'published-premises' });
      }
    }
    Object.values(row).forEach(v => visit(v, depth + 1));
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* Invalid structured evidence cannot verify an address. */ }
  }
  const points = new Map(found.map(v => [`${v.location!.latitude},${v.location!.longitude}`, v]));
  return points.size === 1 ? [...points.values()][0] : null;
}

export async function readOfficialAddressEvidence(address: string, source: string): Promise<AddressEvidence | null> {
  const url = officialAddressSource(source);
  if (!url) return null;
  try {
    const ips = await Promise.race([lookup(url.hostname, { all: true }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), 3000))]);
    if (!ips.length || ips.some(({address: ip}) => /^(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|::|fc|fd|fe80)/i.test(ip))) return null;
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'OpsCenter/1.0 (https://ops.junk-king.app)' } });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || !response.body) return null;
    const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    while (true) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.length; if (size > 300_000) { await reader.cancel(); return null; } chunks.push(value);
    }
    const html = Buffer.concat(chunks).toString('utf8');
    const evidence = publishedAddressEvidence(address, html, url.href);
    return evidence ? { ...evidence, source: `Official published premises · SHA256 ${createHash('sha256').update(html).digest('hex')}` } : null;
  } catch { return null; }
}
