import {crewPhoneBody,crewPhoneResponse,crewPhoneFailure} from './crew-phone-http';
import {CrewPhoneError} from './crew-phone';
import {readCrewJobScope} from './crew-job-scope';
import {signatureSubmission,signatureRequestId} from './appointment-signature';
import {readAppointmentSignature,saveAppointmentSignature} from './crew-job-signatures';
type SignatureScope={phone:{deviceId:string;truck:string};current:{appointmentId:string;date:string};job:{readOnly?:boolean}};
export async function crewSignatureRequest(request:Request,scope:(request:Request,assignmentId:string)=>SignatureScope=readCrewJobScope) {
 try{
  if(request.method==='GET'){
   const params=new URL(request.url).searchParams,assignment=params.get('assignmentId') || '',id=params.get('requestId') || undefined;
   if([...params.keys()].some(key=>!['assignmentId','requestId'].includes(key)) || !signatureRequestId.test(assignment) || (id && !signatureRequestId.test(id)))throw new CrewPhoneError('Use the appointment signature section.',400);
   const {current,job}=scope(request,assignment);
   if(job.readOnly)throw new CrewPhoneError('This appointment is view only.',403);
   return crewPhoneResponse({receipt:readAppointmentSignature(current.appointmentId,id)});
  }
  if(request.method!=='POST')return crewPhoneResponse({error:'Method not allowed.'},405,{Allow:'GET, POST'});
  const body=await crewPhoneBody(request,72*1024);
  let input;try{input=signatureSubmission(body);}catch(error){throw new CrewPhoneError((error as Error).message,400);}
  const {phone,current,job}=scope(request,input.assignmentId);
  if(job.readOnly)throw new CrewPhoneError('This appointment is view only.',403);
  // Synchronous local save after the existing fresh phone/day/inspection/assignment
  // gate. No JunkWare mutation or expansion of cross-truck authority.
  return crewPhoneResponse({receipt:saveAppointmentSignature(input,{deviceId:phone.deviceId,appointmentId:current.appointmentId,date:current.date,truck:phone.truck})});
 }catch(error){return crewPhoneFailure(error);}
}
