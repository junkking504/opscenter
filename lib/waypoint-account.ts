import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from './auth';
import { opsRoleCan } from './ops-roles';

// Account authentication is separate from phone identity and never enrolls a phone.
export async function waypointAccount(request: Request) {
  const values = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${AUTH_SESSION_COOKIE}=`));
  if (values.length !== 1) return null;
  const session = await verifyAuthSessionCookie(values[0].slice(AUTH_SESSION_COOKIE.length + 1));
  return session && opsRoleCan(session.role, 'sensitive.write') ? session : null;
}
