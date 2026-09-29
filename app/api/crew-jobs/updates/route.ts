import { requireCrewDay } from '@/lib/crew-phone-day';
import { requireCrewPhone, requireCrewReady, crewPhoneFailure, crewPhoneResponse } from '@/lib/crew-phone-http';
import { crewAssignedDay } from '@/lib/crew-assigned-day';
import { ensureCrewScheduleDispatch } from '@/lib/crew-schedule-dispatch';

export const runtime='nodejs';
export const dynamic='force-dynamic';

/** Small local-only change check. It never opens JunkWare or another provider. */
export async function GET(request:Request) {
  try {
    const testPhone=requireCrewPhone(request);
    if(testPhone.test)return crewPhoneResponse({updateToken:'test'});
    const phone=requireCrewReady(request),day=requireCrewDay(phone);
    let payload=crewAssignedDay(phone,day.date);
    if(ensureCrewScheduleDispatch(phone.truck,day.date,payload))payload=crewAssignedDay(phone,day.date);
    return crewPhoneResponse({updateToken:payload.updateToken});
  } catch(error) {return crewPhoneFailure(error);}
}
