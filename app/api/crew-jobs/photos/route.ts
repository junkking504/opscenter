import { waypointSandbox } from '@/lib/waypoint-sandbox';
import {readCrewDispatch} from '@/lib/crew-dispatch-store';
import {crewCheckoutDryRun} from '@/lib/crew-checkout-dry-run';
import { crewPhoneBody, crewPhoneFailure, crewPhoneResponse, requireCrewPhone } from '@/lib/crew-phone-http';
import { withCrewJob } from '@/lib/crew-job-scope';
import { CrewPhoneError } from '@/lib/crew-phone';
import { crewPhotos, crewPhotoProjection, parseCrewPhoto, readCrewPhoto, reconcileCrewPhoto, uploadCrewPhoto } from '@/lib/crew-job-photos';
import { uploadJunkwareJobPhoto } from '@/lib/junkware-photo-uploader';
import { junkwareJobCloseout } from '@/lib/junkware-job-closeout';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  try {
    const testPhone=requireCrewPhone(request);
    if(testPhone.test)return crewPhoneResponse(waypointSandbox(testPhone,'photos',new URL(request.url).searchParams));

    requireCrewPhone(request);
    const params=new URL(request.url).searchParams;
    if([...params.keys()].some(key=>!['assignmentId','requestId'].includes(key)))throw new CrewPhoneError('Use the current assignment screen.');
    return await withCrewJob(request,params.get('assignmentId') || '',async({phone,current})=>{
      const id=params.get('requestId');
      if(id){
        const receipt=readCrewPhoto(id);
        if(!receipt || receipt.deviceId!==phone.deviceId || receipt.assignmentId!==current.assignmentId)throw new CrewPhoneError('Photo receipt not found.',404);
        const source=await junkwareJobCloseout(current.appointmentId);
        const result=reconcileCrewPhoto(receipt,source.closeout?.photoEvidence?.urls || []);
        return crewPhoneResponse({receipt:crewPhotoProjection(result)});
      }
      return crewPhoneResponse({photos:crewPhotos(phone.deviceId,current.assignmentId).map(crewPhotoProjection)});
    });
  }catch(error){return crewPhoneFailure(error);}
}
export async function POST(request:Request) {
  try {
    const testPhone=requireCrewPhone(request);
    if(testPhone.test)return crewPhoneResponse(waypointSandbox(testPhone,'photos',new URL(request.url).searchParams,await crewPhoneBody(request,6291456)));

    const phone=requireCrewPhone(request);
    const body=parseCrewPhoto(await crewPhoneBody(request,6*1024*1024));
    const current=readCrewDispatch(phone.truck).current;
    if(current?.assignmentId===body.assignmentId && crewCheckoutDryRun(current,phone.truck))throw new CrewPhoneError('This is a dry run. Photos stay on the phone and are not uploaded to JunkWare.',409);
    return await withCrewJob(request,body.assignmentId,async({phone,current,job})=>{
      if(crewCheckoutDryRun(current,phone.truck))throw new CrewPhoneError('This is a dry run. Photos stay on the phone and are not uploaded to JunkWare.',409);
      const receipt=await uploadCrewPhoto(body,{deviceId:phone.deviceId,appointmentId:current.appointmentId},filePath=>uploadJunkwareJobPhoto({appointmentId:current.appointmentId,jkNumber:job.jkNumber,filePath,category:body.category}));
      return crewPhoneResponse({receipt:crewPhotoProjection(receipt)},receipt.status==='verified'?200:202);
    });
  }catch(error){return crewPhoneFailure(error);}
}
