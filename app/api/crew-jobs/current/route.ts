import { requireCrewPhone, crewPhoneFailure, crewPhoneResponse } from '@/lib/crew-phone-http';
import { crewCurrentPayload } from '@/lib/crew-dispatch-service';
import { crewDispatchSources } from '@/lib/crew-dispatch-sources';
import { requireCrewDay } from '@/lib/crew-phone-day';
import { CrewPhoneError } from '@/lib/crew-phone';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  try {
    const phone=requireCrewPhone(request);
    requireCrewDay(phone);
    // The phone cannot choose another truck, date or appointment through a URL.
    if(new URL(request.url).search) throw new CrewPhoneError('Use the current assignment screen.');
    const payload=await crewCurrentPayload(phone,crewDispatchSources);
    const current=requireCrewPhone(request);
    if(current.deviceId!==phone.deviceId || current.truck!==phone.truck) throw new CrewPhoneError('Phone access changed. Contact dispatch.',401);
    return crewPhoneResponse(payload);
  } catch(error) {return crewPhoneFailure(error);}
}
