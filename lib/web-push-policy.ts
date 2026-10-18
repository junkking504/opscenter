import { createHash } from 'node:crypto';
export const APPLE_PUSH_ORIGIN = 'https://web.push.apple.com';
export const PUSH_CATEGORIES = ['schedule', 'krewe', 'fleet'] as const;
export type PushCategory = typeof PUSH_CATEGORIES[number];
export const PUSH_ACTIONS = { subscribe: 'push.device.subscribe', unsubscribe: 'push.device.unsubscribe' } as const;
export const pushHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function pushEndpoint(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid push endpoint.');
  const url = new URL(value);
  // Initial Safari/iPhone scope. Exact provider host, port and token path only;
  // no user-configurable allowlist, redirects, arbitrary URLs or proxy support.
  if (url.protocol !== 'https:' || url.origin !== APPLE_PUSH_ORIGIN || url.port || url.username || url.password || url.search || url.hash || !/^\/Q[A-Za-z0-9_-]{16,1024}$/.test(url.pathname)) throw new Error('Only Apple Web Push endpoints are supported.');
  return url;
}
export function pushCategories(value: unknown): PushCategory[] {
  if (!Array.isArray(value) || !value.length || value.length > 3 || value.some(v => !PUSH_CATEGORIES.includes(v))) throw new Error('Select supported notification categories.');
  return [...new Set(value)] as PushCategory[];
}
export function pushSubscription(value: unknown) {
  const input = value as { endpoint?: unknown; keys?: {p256dh?: unknown; auth?: unknown}; expirationTime?: unknown };
  const endpoint = pushEndpoint(input?.endpoint).href;
  const key = (v: unknown, length: number) => {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_-]+$/.test(v) || Buffer.from(v, 'base64url').length !== length) throw new Error('Invalid subscription keys.');
    return v;
  };
  const p256dh = key(input.keys?.p256dh, 65), auth = key(input.keys?.auth, 16);
  if (Buffer.from(p256dh, 'base64url')[0] !== 4) throw new Error('Invalid subscription key.');
  const expiration = input.expirationTime;
  if (expiration != null && (typeof expiration !== 'number' || !Number.isFinite(expiration) || expiration <= Date.now())) throw new Error('Subscription has expired.');
  return { endpoint, keys: {p256dh, auth}, expirationTime: expiration as number | null | undefined };
}
export function validPushOrigin(value: string|undefined): boolean {
  try {const url=new URL(value || '');return url.protocol==='https:' && value===url.origin && !url.username && !url.password;} catch {return false;}
}
export function pushEnrollmentEnabled(env: Readonly<Record<string,string|undefined>> = process.env): boolean {
  return validPushOrigin(env.OPSCENTER_WEB_PUSH_ORIGIN) && env.OPSCENTER_RUNTIME === 'MISSION_CONTROL' && env.OPSCENTER_WEB_PUSH_ENABLED === '1'
    && !!env.OPSCENTER_WEB_PUSH_ACTIVATED_AT && Number.isFinite(Date.parse(env.OPSCENTER_WEB_PUSH_ACTIVATED_AT))
    && Date.parse(env.OPSCENTER_WEB_PUSH_ACTIVATED_AT) <= Date.now()
    && /^[A-Za-z0-9_-]{87}$/.test(env.OPSCENTER_WEB_PUSH_PUBLIC_KEY || '')
    && /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OPSCENTER_WEB_PUSH_SUBJECT || '');
}
export function pushOutcome(status: number): 'accepted' | 'expired' | 'rejected' {
  return status === 201 ? 'accepted' : [404,410].includes(status) ? 'expired' : 'rejected';
}

/** Signing capability belongs only to the dispatcher process. */
export function pushEnabled(env: Readonly<Record<string,string|undefined>> = process.env): boolean {
  return pushEnrollmentEnabled(env) && env.OPSCENTER_PROCESS_ROLE === 'push-dispatcher'
    && /^[A-Za-z0-9_-]{43}$/.test(env.OPSCENTER_WEB_PUSH_PRIVATE_KEY || '');
}
