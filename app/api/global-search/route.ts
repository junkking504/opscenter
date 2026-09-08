import { NextResponse } from "next/server";
import { buildGlobalSearchResponse,type AppointmentSearchScope } from "@/lib/global-search";
import { validOperatingDate } from "@/lib/platform/request-actor";
import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {authorizeOpsRequest} from '@/lib/ops-roles';

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor=await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value||'');
  if(!actor)return NextResponse.json({error:'Authentication required.'},{status:401});
  if(!authorizeOpsRequest(actor.role,'/api/global-search','GET').allowed)return NextResponse.json({error:'Search is not permitted.'},{status:403});
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim().slice(0, 120);
  const date = validOperatingDate(url.searchParams.get("date"));
  const rawScope=url.searchParams.get('scope')||'all';
  if(!['all','upcoming','past'].includes(rawScope))return NextResponse.json({error:'Choose Upcoming, Past, or All.'},{status:400});
  const scope=rawScope as AppointmentSearchScope,rawLimit=Number(url.searchParams.get('limit')||10),limit=Number.isFinite(rawLimit)?Math.max(10,Math.min(100,Math.trunc(rawLimit))):10;
  try {
  const response = query.length >= 2 ? buildGlobalSearchResponse(query,date,scope,limit) : {results:[]};
  return NextResponse.json(
    { query, date, scope,...response },
    { headers: { "Cache-Control": "private, no-store" } },
  );
  }catch{return NextResponse.json({error:'Source search is unavailable. Try again.'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
}
