import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {opsRoleCan} from '@/lib/ops-roles';
import {isDesktopWriteOriginAllowed} from '@/lib/desktop-request-origin';
import {deletePayrollCorrection,payrollCorrectionForEmployee,upsertPayrollCorrection} from '@/lib/payroll-corrections';
import {assertPayrollSyncEditable,payrollSyncForCorrection,stagePayrollSync,runPayrollSync} from '@/lib/junkware-payroll-sync';
const headers={'Cache-Control':'private, no-store, max-age=0'};
const session=async()=>verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value||'');
export async function GET(request:Request) {
  const actor=await session();if(!actor)return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!opsRoleCan(actor.role,'finance.read'))return Response.json({error:'Manager payroll access required.'},{status:403,headers});
  const params=new URL(request.url).searchParams,correction=payrollCorrectionForEmployee(params.get('date')||'',params.get('employee')||'');
  let sync=payrollSyncForCorrection(correction);
  if(sync&&params.get('verify')==='1'&&sync.status!=='pending')sync=await runPayrollSync(sync.id,true);
  return Response.json({correction,sync:sync&&{status:sync.status,message:sync.message,verifiedAt:sync.verifiedAt}},{headers});
}
export async function POST(request:Request) {
  const actor=await session();if(!actor)return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!opsRoleCan(actor.role,'sensitive.write')||!isDesktopWriteOriginAllowed(request))return Response.json({error:'This payroll change is not permitted.'},{status:403,headers});
  const body=await request.json().catch(()=>null);if(!body||typeof body!=='object')return Response.json({error:'Invalid correction.'},{status:400,headers});
  try {
    let correction=payrollCorrectionForEmployee(String(body.workDate||''),String(body.employeeName||''));
    const unchanged=correction&&['clockIn','clockOut','hourlyRate','note'].every(key=>String(correction![key as keyof typeof correction]??'')===String(body[key]??''));
    if(!unchanged){assertPayrollSyncEditable(String(body.workDate||''),String(body.employeeName||''));correction=upsertPayrollCorrection({employeeName:String(body.employeeName||''),workDate:String(body.workDate||''),clockIn:String(body.clockIn||''),clockOut:String(body.clockOut||''),hourlyRate:Number(body.hourlyRate),note:String(body.note||''),updatedBy:actor.email});}
    if(!correction)return Response.json({error:'Enter a valid clock-in, hourly rate, and correction reason.'},{status:400,headers});
    const sync=await runPayrollSync(stagePayrollSync(correction).id);
    return Response.json({ok:sync.status==='verified',correction,sync:{status:sync.status,message:sync.message,verifiedAt:sync.verifiedAt}},{status:sync.status==='verified'?200:202,headers});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Correction could not be confirmed.'},{status:409,headers});}
}
export async function DELETE(request:Request) {
  const actor=await session();if(!actor)return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!opsRoleCan(actor.role,'sensitive.write')||!isDesktopWriteOriginAllowed(request))return Response.json({error:'This payroll change is not permitted.'},{status:403,headers});
  const params=new URL(request.url).searchParams,date=params.get('date')||'',name=params.get('employee')||'',correction=payrollCorrectionForEmployee(date,name);
  const sync=payrollSyncForCorrection(correction);
  if(sync)return Response.json({error:'This correction has a JunkWare synchronization record. Enter the desired times and save a new correction to change both systems; removing the local audit would not undo JunkWare.'},{status:409,headers});
  const deleted=deletePayrollCorrection(date,name,actor.email);return Response.json({ok:deleted},{status:deleted?200:404,headers});
}
