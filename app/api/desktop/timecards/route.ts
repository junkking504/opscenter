import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {opsRoleCan} from '@/lib/ops-roles';
import {isDesktopWriteOriginAllowed} from '@/lib/desktop-request-origin';
import {readDesktopKreweDay} from '@/lib/desktop-krewe';
import {readTimecardDelete,publicTimecardDelete,runTimecardDeleteWorker} from '@/lib/timecard-deletions';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0'};
async function actor(){return verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value||'');}
export async function GET(request:Request){
 const session=await actor();if(!session)return Response.json({error:'Authentication required.'},{status:401,headers});
 if(!opsRoleCan(session.role,'sensitive.write'))return Response.json({error:'Manager access required.'},{status:403,headers});
 try{const row=readTimecardDelete(new URL(request.url).searchParams.get('id')||'');if(!row||row.actor!==session.email)return Response.json({error:'Receipt not found.'},{status:404,headers});return Response.json({receipt:publicTimecardDelete(row)},{headers});}catch{return Response.json({error:'Receipt could not be read.'},{status:400,headers});}
}
export async function POST(request:Request){
 const session=await actor();if(!session)return Response.json({error:'Authentication required.'},{status:401,headers});
 if(!opsRoleCan(session.role,'sensitive.write')||!isDesktopWriteOriginAllowed(request))return Response.json({error:'This payroll change is not permitted.'},{status:403,headers});
 const body=await request.json().catch(()=>null);if(!body||!['preview','delete','check'].includes(body.action))return Response.json({error:'Invalid action.'},{status:400,headers});
 try{
  if(body.action==='preview'){
   const day=readDesktopKreweDay(String(body.date||''),String(body.name||''),String(body.periodDate||body.date||''),session.role);
   const result=await runTimecardDeleteWorker(['--preview','--employee',day.member.name,'--date',day.date,'--actor',session.email]);
   const row=readTimecardDelete(String(result.id));if(!row||row.actor!==session.email)throw new Error('Source preview unavailable.');
   return Response.json({receipt:publicTimecardDelete(row)},{headers});
  }
  let row=readTimecardDelete(String(body.id||''));if(!row||row.actor!==session.email)return Response.json({error:'Receipt not found.'},{status:404,headers});
  if(body.action==='delete'&&body.confirm!==true)return Response.json({error:'Confirm the exact entry before deletion.'},{status:400,headers});
  if(!['verified','failed'].includes(row.status)){
   try{await runTimecardDeleteWorker(['--id',row.id,...(body.action==='check'?['--check']:[])]);}catch{
    row=readTimecardDelete(row.id)!;
    return Response.json({receipt:publicTimecardDelete(row),error:row.submittedAt?'Deletion result unconfirmed. Check saved result; do not submit another deletion.':'Source verification could not finish. No verified deletion. Check saved result.'},{status:202,headers});
   }
  }
  row=readTimecardDelete(row.id)!;
  return Response.json({receipt:publicTimecardDelete(row)},{status:row.status==='verified'||row.status==='preview'?200:row.status==='failed'?409:202,headers});
 }catch{return Response.json({error:'Could not verify one same-day source entry. Check JunkWare for multiple shifts, overnight entries or a sign-in issue. Nothing was automatically retried.'},{status:409,headers});}
}
