import {crewPhoneBody,crewPhoneFailure,crewPhoneResponse,requireCrewPhone} from '@/lib/crew-phone-http';
import {CrewPhoneError} from '@/lib/crew-phone';
import {beginTruckSwitch,continueTruckSwitch,previewTruckSwitch} from '@/lib/crew-truck-switch';
import {pendingTruckSwitch,truckSwitchSummary} from '@/lib/crew-truck-switch-store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const phone=requireCrewPhone(request),params=new URL(request.url).searchParams;
 if([...params.keys()].some(k=>k!=='truck'))throw new CrewPhoneError('Use Switch truck.');
 const pending=pendingTruckSwitch(phone.deviceId);
 if(pending)return crewPhoneResponse({switch:truckSwitchSummary(pending)});
 const truck=params.get('truck');
 return crewPhoneResponse(truck?{preview:previewTruckSwitch(phone,truck)}:{switch:null});
}catch(error){return crewPhoneFailure(error);}}
export async function POST(request:Request){try{
 const body=await crewPhoneBody(request),phone=requireCrewPhone(request);
 if(body.action==='continue' && Object.keys(body).some(k=>!['action','requestId'].includes(k)))throw new CrewPhoneError('Use the saved switch reference.');
 const saved=body.action==='confirm'?await beginTruckSwitch(phone,body):body.action==='continue'?await continueTruckSwitch(phone,String(body.requestId)):null;
 if(!saved)throw new CrewPhoneError('Choose a valid switch action.');
 return crewPhoneResponse({switch:truckSwitchSummary(saved)});
}catch(error){return crewPhoneFailure(error);}}
