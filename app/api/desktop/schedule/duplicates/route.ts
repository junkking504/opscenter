import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { authorizeOpsRequest } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { readDesktopSchedule } from '@/lib/desktop-schedule';
import { readDuplicateReviews, saveDuplicateReview, DuplicateReviewConflict } from '@/lib/duplicate-booking-reviews';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0'};
function validDate(date:string) { return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date; }
export async function GET(request:Request) {
  const actor=await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value||'');
  if(!actor)return Response.json({error:'Authentication required.'},{status:401,headers});
  const date=new URL(request.url).searchParams.get('date')||'';
  if(!validDate(date))return Response.json({error:'A valid operating date is required.'},{status:400,headers});
  try { return Response.json({reviews:readDuplicateReviews(date,readDesktopSchedule(date).appointments)},{headers}); }
  catch {return Response.json({error:'Saved duplicate reviews are unavailable. Treat these pairs as needing review.'},{status:503,headers});}
}
export async function POST(request:Request) {
  const actor=await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value||'');
  if(!actor)return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!isDesktopWriteOriginAllowed(request)||!authorizeOpsRequest(actor.role,'/api/desktop/schedule/duplicates','POST').allowed)return Response.json({error:'This review is not allowed.'},{status:403,headers});
  try {
    const body=await request.json();
    if(!body||!validDate(body.date)||typeof body.key!=='string'||body.key.length>300||!Array.isArray(JSON.parse(body.key))||!/^[a-f0-9]{64}$/.test(body.fingerprint)||!['keep_both','review'].includes(body.state)||!(body.expectedRevision===null||typeof body.expectedRevision==='string'&&body.expectedRevision.length<=64))return Response.json({error:'A current appointment pair and review decision are required.'},{status:400,headers});
    const review=saveDuplicateReview(body,actor.email,()=>readDesktopSchedule(body.date).appointments);
    return Response.json({review},{headers});
  } catch(error) {
    return Response.json({error:error instanceof DuplicateReviewConflict?error.message:error instanceof SyntaxError?'Invalid review request.':'The review could not be confirmed. Refresh before retrying.'},{status:error instanceof DuplicateReviewConflict?409:error instanceof SyntaxError?400:503,headers});
  }
}
