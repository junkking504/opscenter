import { type AuthSession, AUTH_SESSION_COOKIE, isNamedOpsIdentity, verifyAuthSessionCookie } from './auth';
import { opsRoleCan } from './ops-roles';

export function isWaypointAccount(session: Pick<AuthSession, 'email' | 'role'> | null): boolean {
  return Boolean(session && isNamedOpsIdentity(session.email) && opsRoleCan(session.role, 'sensitive.write'));
}

// Account authentication is separate from phone identity and never enrolls a phone.
export async function waypointAccount(request: Request) {
  const values = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${AUTH_SESSION_COOKIE}=`));
  if (values.length !== 1) return null;
  const session = await verifyAuthSessionCookie(values[0].slice(AUTH_SESSION_COOKIE.length + 1));
  return isWaypointAccount(session) ? session : null;
}
