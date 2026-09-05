import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {opsRoleCan} from '@/lib/ops-roles';
import {InvalidPhotoReviewFilter,readPhotoPreview,readPhotoReview} from '@/lib/desktop-photo-review';
export const dynamic='force-dynamic';
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
  try{return Response.json(readPhotoReview(params),{headers});}
  catch(error){return Response.json({error:error instanceof InvalidPhotoReviewFilter?'Photo review filters are invalid.':'The photo queue could not be read.'},{status:error instanceof InvalidPhotoReviewFilter?400:503,headers});}
}
