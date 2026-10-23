import { waypointAccount } from '@/lib/waypoint-account';
import { opsAuthDisplayName } from '@/lib/auth';
import { crewPhoneResponse } from '@/lib/crew-phone-http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const account = await waypointAccount(request);
  return crewPhoneResponse({ manager: Boolean(account), displayName: account ? opsAuthDisplayName(account.email) : null });
}
