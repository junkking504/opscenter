import { requireCrewReady, crewPhoneFailure, crewPhoneResponse } from '@/lib/crew-phone-http';
import { crewCurrentPayload } from '@/lib/crew-dispatch-service';
import { crewDispatchSources } from '@/lib/crew-dispatch-sources';
import { requireCrewDay } from '@/lib/crew-phone-day';
import { readCrewDispatch } from '@/lib/crew-dispatch-store';
import { CrewPhoneError } from '@/lib/crew-phone';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  try {
    const phone=requireCrewReady(request);
    const day=requireCrewDay(phone);
    // The phone cannot choose another truck, date or appointment through a URL.
    if(new URL(request.url).search) throw new CrewPhoneError('Use the current assignment screen.');
    if(readCrewDispatch(phone.truck).current && readCrewDispatch(phone.truck).current?.date!==day.date)throw new CrewPhoneError('Dispatch has not released a current job for today. Contact dispatch.',409);
    const payload=await crewCurrentPayload(phone,crewDispatchSources);
    const current=requireCrewReady(request);
    if(current.deviceId!==phone.deviceId || current.truck!==phone.truck || requireCrewDay(current).version!==day.version) throw new CrewPhoneError('Today’s truck setup changed. Refresh your assignment.',409);
    return crewPhoneResponse(payload);
  } catch(error) {return crewPhoneFailure(error);}
}
