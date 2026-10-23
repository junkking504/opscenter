import { AUTH_SESSION_COOKIE, isNamedOpsIdentity, verifyAuthSessionCookie } from './auth';
import { opsRoleCan } from './ops-roles';

// Account authentication is separate from phone identity and never enrolls a phone.
export async function waypointAccount(request: Request) {
  const values = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${AUTH_SESSION_COOKIE}=`));
  if (values.length !== 1) return null;
  const session = await verifyAuthSessionCookie(values[0].slice(AUTH_SESSION_COOKIE.length + 1));
  return session && isNamedOpsIdentity(session.email) && opsRoleCan(session.role, 'sensitive.write') ? session : null;
}
