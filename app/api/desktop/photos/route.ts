import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {opsRoleCan} from '@/lib/ops-roles';
import {InvalidPhotoReviewFilter,readPhotoPreview,readPhotoReview} from '@/lib/desktop-photo-review';
import {photoReviewRoot} from '@/lib/desktop-photo-review';
import {isDesktopWriteOriginAllowed} from '@/lib/desktop-request-origin';
import {photoAppointmentOptions} from '@/lib/desktop-photo-appointments';
import {assignReviewedPhoto, readPhotoAssignmentStatus, PhotoAssignmentError} from '@/lib/whatsapp-photo-review-assignment';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request){
  const session=await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value||'');
  if(!session)return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!opsRoleCan(session.role,'sensitive.write'))return Response.json({error:'A manager is required to review held photos.'},{status:403,headers});
  const params=new URL(request.url).searchParams;
  if(params.has('preview')){
    const preview=readPhotoPreview(params.get('preview')||'',params.get('state')||'');
    return preview?new Response(new Uint8Array(preview.bytes),{headers:{...headers,'Content-Type':preview.mimeType,'Content-Security-Policy':"default-src 'none'; sandbox"}}):Response.json({error:'A cached preview is unavailable.'},{status:404,headers});
  }
  try{
    if(params.has('appointments'))return Response.json(photoAppointmentOptions(params.get('appointments')||''),{headers});
    if(params.has('record'))return Response.json(readPhotoAssignmentStatus(photoReviewRoot(),params.get('record')||''),{headers});
    return Response.json(readPhotoReview(params),{headers});
  }
  catch(error){return Response.json({error:error instanceof PhotoAssignmentError?error.message:error instanceof InvalidPhotoReviewFilter?'Photo review filters are invalid.':'The photo queue could not be read.'},{status:error instanceof PhotoAssignmentError?error.status:error instanceof InvalidPhotoReviewFilter?400:503,headers});}
}
export async function POST(request:Request){
  const session=await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value||'');
  if(!session)return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!opsRoleCan(session.role,'sensitive.write')||!isDesktopWriteOriginAllowed(request))return Response.json({error:'Manager access and a same-site request are required.'},{status:403,headers});
  try{
    const reader=request.body?.getReader();if(!reader)throw new PhotoAssignmentError('A photo assignment is required.');
    const chunks:Uint8Array[]=[];let size=0;
    for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>4096){await reader.cancel();throw new PhotoAssignmentError('The assignment is too large.',413);}chunks.push(chunk.value);}
    let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new PhotoAssignmentError('Invalid photo assignment.');}
    return Response.json(assignReviewedPhoto(input,session.email,photoReviewRoot(),photoAppointmentOptions),{headers});
  }catch(error){return Response.json({error:error instanceof PhotoAssignmentError?error.message:'The assignment result could not be confirmed. Check upload status before retrying.'},{status:error instanceof PhotoAssignmentError?error.status:503,headers});}
}
