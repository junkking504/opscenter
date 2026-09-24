import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// New requests require a separately verified no-payment-method account. This
// local cap does not control other applications sharing the provider account.
const MAX_REQUESTS = 2_500;
const WINDOW_MS = 25 * 60 * 60_000; // Covers even a 25-hour provider calendar day.
const endpoint = 'https://api.geocod.io/v2/geocode';
type Configuration = { schema: 1; enabled: true; provider: 'geocodio'; maxSpendMicros: 0;
  maxRequests: number; noPaymentMethod: true; verifiedAt: string; validUntil: string; apiKey: string };
type Cached = { expires: number; payload: unknown };
type Ledger = { schema: 1; lastAt: number; attempts: number[]; blockedUntil: number; cache: Record<string, Cached> };
type Outcome = { payload?: unknown; reason?: string; retryAfterMs?: number };
const protectedRoot = () => path.join(process.env.HOME || '', 'Library/Application Support/OpsCenter');
const configFile = () => process.env.GEOCODIO_FREE_CONFIG_FILE || path.join(protectedRoot(), 'geocodio-free-fallback.json');
const stateFile = () => process.env.GEOCODIO_FREE_STATE_FILE || path.join(protectedRoot(), 'geocodio-free-usage.json');

function configuration(now: number): Configuration | null {
  try {
    const c = JSON.parse(fs.readFileSync(configFile(), 'utf8')) as Configuration;
    if (c.schema !== 1 || c.enabled !== true || c.provider !== 'geocodio' || c.maxSpendMicros !== 0
      || c.noPaymentMethod !== true || !Number.isInteger(c.maxRequests) || c.maxRequests < 1 || c.maxRequests > MAX_REQUESTS
      || !Number.isFinite(Date.parse(c.verifiedAt)) || Date.parse(c.verifiedAt) > now
      || !Number.isFinite(Date.parse(c.validUntil)) || Date.parse(c.validUntil) <= now
      || Date.parse(c.validUntil) - Date.parse(c.verifiedAt) > 31 * 86_400_000
      || typeof c.apiKey !== 'string' || !c.apiKey.trim() || /\s/.test(c.apiKey)) return null;
    return c;
  } catch { return null; }
}

function readLedger(file: string, now: number): Ledger {
  const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Ledger;
  if (s.schema !== 1 || !Number.isSafeInteger(s.lastAt) || s.lastAt < 0 || s.lastAt > now
    || !Number.isSafeInteger(s.blockedUntil) || s.blockedUntil < 0 || !Array.isArray(s.attempts)
    || s.attempts.some((at, index) => !Number.isSafeInteger(at) || at < 0 || at > s.lastAt || (index > 0 && at < s.attempts[index - 1]))
    || !s.cache || typeof s.cache !== 'object' || Array.isArray(s.cache)
    || Object.entries(s.cache).some(([key, value]) => !/^[a-f0-9]{64}$/.test(key) || !value || !Number.isSafeInteger(value.expires))) throw new Error('Invalid ledger');
  return s;
}

function saveLedger(file: string, state: Ledger) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    const directory = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally { try { fs.unlinkSync(temp); } catch { /* Already renamed. */ } }
}

export async function geocodioAddressJson(query: string, identity: string, budgetMs: number): Promise<Outcome | null> {
  const now = Date.now(), config = configuration(now);
  if (!config) return null;
  const pending = (reason: string, delay = 60_000): Outcome => ({ reason, retryAfterMs: Math.max(60_000, delay) });
  if (budgetMs < 1_000) return pending('Geocodio Free Check Pending');
  const file = stateFile(), lock = `${file}.lock`;
  let fd: number;
  // No automatic stale-lock deletion: a crashed owner must be reviewed before
  // another request can risk spending. Missing history is never reinitialized.
  try { fd = fs.openSync(lock, 'wx', 0o600); } catch { return pending('Geocodio Usage Guard Unavailable'); }
  try {
    const state = readLedger(file, now);
    const key = createHash('sha256').update(identity).digest('hex');
    const cached = state.cache[key];
    if (cached?.expires > now) return { payload: cached.payload };
    if (state.blockedUntil > now) return pending('Geocodio Free Provider Paused', state.blockedUntil - now);
    state.attempts = state.attempts.filter(at => at > now - WINDOW_MS);
    if (state.attempts.length >= config.maxRequests) return pending('Geocodio Free Request Limit Reached', state.attempts[0] + WINDOW_MS - now);
    if (state.attempts.length && now - state.attempts[state.attempts.length - 1] < 10_000) return pending('Geocodio Free Check Pending');
    state.cache = Object.fromEntries(Object.entries(state.cache).filter(([, value]) => value.expires > now));
    state.attempts.push(now); state.lastAt = now;
    // Reserve durably BEFORE fetch. Failed/uncertain requests are never refunded.
    saveLedger(file, state);
    try {
      const params = new URLSearchParams({ q: query, country: 'USA' });
      const response = await fetch(`${endpoint}?${params}`, { headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(Math.min(8_000, Math.floor(budgetMs))), cache: 'no-store', redirect: 'error' });
      if (!response.ok) {
        if ([401, 403, 429].includes(response.status)) {
          state.blockedUntil = now + WINDOW_MS; saveLedger(file, state);
        }
        return pending('Geocodio Free Provider Unavailable', state.blockedUntil - now);
      }
      const payload: unknown = await response.json();
      if (!payload || !Array.isArray((payload as { results?: unknown }).results)) return pending('Geocodio Response Unavailable');
      // Persist provider evidence, not an unvalidated accepted location. The
      // strict verifier always runs again when this cache is read.
      state.cache[key] = { expires: now + 6 * 60 * 60_000, payload };
      saveLedger(file, state);
      return { payload };
    } catch { return pending('Geocodio Free Provider Temporarily Unavailable'); }
  } catch { return pending('Geocodio Usage History Needs Review'); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
