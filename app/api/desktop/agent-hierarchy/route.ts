import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {opsRoleCan} from '@/lib/ops-roles';
import {readHierarchy} from '@/lib/agent-hierarchy';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0'};
export async function GET() {
  const actor=await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value||'');
  if(!actor)return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!opsRoleCan(actor.role,'finance.read'))return Response.json({error:'Manager access is required for cross-page supervision.'},{status:403,headers});
  try {
    const snapshot=readHierarchy();
    return snapshot?Response.json(snapshot,{headers}):Response.json({error:'Waiting for the first hierarchy assessment.'},{status:503,headers});
  }catch {return Response.json({error:'Hierarchy evidence could not be read. Existing ownership records are preserved.'},{status:503,headers});}
}
