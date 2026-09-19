import {assertTruckNotSwitching} from './crew-truck-switch-store';
import { readCrewDay } from './crew-phone-day';
import { requireCrewInspection } from './crew-phone-inspection';
import { resolveRequestOrigin } from './auth';
import { CREW_PHONE_COOKIE, CrewPhoneError } from './crew-phone';
import { crewPhone, enrollCrewPhone, revokeCrewPhone } from './crew-phone-store';

export function crewPhoneResponse(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0', ...extra } });
}
export function crewPhoneFailure(error: unknown) {
  return crewPhoneResponse({ error: error instanceof CrewPhoneError ? error.message : 'Phone access could not be verified. Try again or contact your manager.' }, error instanceof CrewPhoneError ? error.status : 503);
}
export async function crewPhoneBody(request: Request, limit = 4096) {
  if (request.headers.get('origin') !== resolveRequestOrigin(request) || request.headers.get('sec-fetch-site') === 'cross-site') throw new CrewPhoneError('Open the company phone app to continue.', 403);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new CrewPhoneError('Send a JSON request.', 415);
  if (Number(request.headers.get('content-length') || 0) > limit) throw new CrewPhoneError('The request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new CrewPhoneError('Enter a valid request.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new CrewPhoneError('The request is too large.', 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new CrewPhoneError('Enter a valid request.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CrewPhoneError('Enter a valid request.');
  return value as Record<string, unknown>;
}
function phoneKey(request: Request) {
  const matches = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${CREW_PHONE_COOKIE}=`));
  return matches.length === 1 ? matches[0].slice(CREW_PHONE_COOKIE.length + 1) : '';
}
export function requireCrewPhone(request: Request) {
  if (!resolveRequestOrigin(request).startsWith('https://')) throw new CrewPhoneError('Open the secure company phone address.', 403);
  const phone = crewPhone(phoneKey(request));
  if (!phone) throw new CrewPhoneError('This phone needs manager setup.', 401);
  const day=readCrewDay(phone);
  return day ? {...phone,truck:day.truck} : phone;
}
export function requireCrewReady(request: Request) {
  const phone=requireCrewPhone(request);
  assertTruckNotSwitching(phone.truck);
  requireCrewInspection(phone);
  return phone;
}
export async function crewPhoneSession(request: Request) {
  try {
    // No tokens over plaintext, including the browser-generated enrollment key.
    if (!resolveRequestOrigin(request).startsWith('https://')) throw new CrewPhoneError('Open the secure company phone address.', 403);
    if (request.method === 'GET') return crewPhoneResponse({ phone: requireCrewPhone(request) });
    if (request.method !== 'POST') return crewPhoneResponse({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
    const body = await crewPhoneBody(request);
    if (body.action === 'disconnect') {
      const phone = requireCrewPhone(request);
      revokeCrewPhone(phone.deviceId, `device:${phone.deviceId}`);
      return crewPhoneResponse({ disconnected: true }, 200, { 'Set-Cookie': `${CREW_PHONE_COOKIE}=; Path=/api/crew-jobs; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
    }
    if (body.action !== 'enroll' || Object.keys(body).some(key => !['action', 'code', 'connectionKey'].includes(key))) throw new CrewPhoneError('Choose a valid phone setup action.');
    if (crewPhone(phoneKey(request))) throw new CrewPhoneError('This phone is already connected. Choose today’s truck in daily setup.', 409);
    const phone = enrollCrewPhone(body.code, body.connectionKey);
    return crewPhoneResponse({ phone }, 200, { 'Set-Cookie': `${CREW_PHONE_COOKIE}=${body.connectionKey}; Path=/api/crew-jobs; HttpOnly; Secure; SameSite=Strict; Expires=${new Date(phone.expiresAt).toUTCString()}` });
  } catch (error) { return crewPhoneFailure(error); }
}
