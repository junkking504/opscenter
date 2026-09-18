import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, opsAuthRole } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { JUNKWARE_DISPATCH_TRUCKS } from '@/lib/junkware-trucks';
import { CrewPhoneError } from '@/lib/crew-phone';
import { createCrewPhoneEnrollment, listCrewPhones, revokeCrewPhone } from '@/lib/crew-phone-store';
import { crewPhoneBody, crewPhoneFailure, crewPhoneResponse } from '@/lib/crew-phone-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function manager() {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) throw new CrewPhoneError('Sign in to OpsCenter.', 401);
  if (!opsRoleCan(opsAuthRole(actor.email), 'sensitive.write')) throw new CrewPhoneError('A manager must set up company phones.', 403);
  return actor;
}
export async function GET() {
  try {
    await manager();
    return crewPhoneResponse({ phones: listCrewPhones(), trucks: JUNKWARE_DISPATCH_TRUCKS });
  } catch (error) { return crewPhoneFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await manager();
    const body = await crewPhoneBody(request);
    if (body.action === 'enroll') return crewPhoneResponse({ enrollment: createCrewPhoneEnrollment(String(body.truck || ''), String(body.label || ''), actor.email) });
    if (body.action === 'revoke') {
      revokeCrewPhone(String(body.deviceId || ''), actor.email);
      return crewPhoneResponse({ phones: listCrewPhones() });
    }
    throw new CrewPhoneError('Choose a valid company phone action.');
  } catch (error) { return crewPhoneFailure(error); }
}
