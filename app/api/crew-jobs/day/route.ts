import {JUNKWARE_DISPATCH_TRUCKS} from '@/lib/junkware-trucks';
import {crewInspectionState} from '@/lib/crew-phone-inspection';
import {chicagoDateKey} from '@/lib/chicago-date';
import {requireCrewPhone,crewPhoneBody,crewPhoneFailure,crewPhoneResponse} from '@/lib/crew-phone-http';
import {crewDayRoster,readCrewDay,saveCrewDay} from '@/lib/crew-phone-day';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const phone=requireCrewPhone(request);return crewPhoneResponse({date:chicagoDateKey(),day:readCrewDay(phone),roster:crewDayRoster(),trucks:JUNKWARE_DISPATCH_TRUCKS,phone,inspection:crewInspectionState(phone)});}catch(error){return crewPhoneFailure(error);}}
export async function POST(request:Request){try{const body=await crewPhoneBody(request);const phone=requireCrewPhone(request);const day=saveCrewDay(phone,body);requireCrewPhone(request);return crewPhoneResponse({day});}catch(error){return crewPhoneFailure(error);}}
