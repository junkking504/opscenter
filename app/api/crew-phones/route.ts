import { waypointManagerActor } from '@/lib/waypoint-manager-context';
import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { readCrewPhoneDirectory } from '@/lib/crew-phone-directory';
import { crewPhoneDeliveryAvailability, listCrewPhoneDeliveries, sendCrewPhoneSetup } from '@/lib/crew-phone-delivery';
import { JUNKWARE_DISPATCH_TRUCKS } from '@/lib/junkware-trucks';
import { CrewPhoneError } from '@/lib/crew-phone';
import { authorizeCrewPhoneLive, createCrewPhoneEnrollment, listCrewPhones, revokeCrewPhone } from '@/lib/crew-phone-store';
import { crewPhoneBody, crewPhoneFailure, crewPhoneResponse } from '@/lib/crew-phone-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function manager(request:Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '') || waypointManagerActor(request);
  if (!actor) throw new CrewPhoneError('Sign in to OpsCenter.', 401);
  if (!opsRoleCan(actor.role, 'sensitive.write')) throw new CrewPhoneError('A manager must set up company phones.', 403);
  return actor;
}
export async function GET(request:Request) {
  try {
    await manager(request);
    return crewPhoneResponse({ phones: listCrewPhones(), trucks: JUNKWARE_DISPATCH_TRUCKS, directory: readCrewPhoneDirectory(), delivery: crewPhoneDeliveryAvailability(), deliveries: listCrewPhoneDeliveries() });
  } catch (error) { return crewPhoneFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await manager(request);
    const body = await crewPhoneBody(request);
    if (body.action === 'send-setup' || body.action === 'send-test') {
      if (Object.keys(body).some(key => !['action', 'truck', 'requestId'].includes(key))) throw new CrewPhoneError('Use the saved company phone for setup delivery.');
      return crewPhoneResponse({ deliveryReceipt: await sendCrewPhoneSetup(String(body.truck || ''), String(body.requestId || ''), actor.email, body.action === 'send-test') });
    }
    if (body.action === 'enroll') return crewPhoneResponse({ enrollment: createCrewPhoneEnrollment(String(body.truck || ''), String(body.label || ''), actor.email) });
    if (body.action === 'authorize-live') {
      if (Object.keys(body).some(key => !['action','deviceId'].includes(key))) throw new CrewPhoneError('Choose one enrolled sandbox phone.');
      authorizeCrewPhoneLive(String(body.deviceId || ''),actor.email);
      return crewPhoneResponse({ phones: listCrewPhones(), deliveries: listCrewPhoneDeliveries() });
    }
    if (body.action === 'revoke') {
      revokeCrewPhone(String(body.deviceId || ''), actor.email);
      return crewPhoneResponse({ phones: listCrewPhones(), deliveries: listCrewPhoneDeliveries() });
    }
    throw new CrewPhoneError('Choose a valid company phone action.');
  } catch (error) { return crewPhoneFailure(error); }
}
