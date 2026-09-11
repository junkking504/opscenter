import type { Page } from '@playwright/test';
export type DispatchSource = {appointmentId:string;date:string;truck:string;start:number;duration:number;status:string;protectedCloseout:unknown};
/** Use the same move endpoint as JunkWare's draggable daily schedule blocks.
 * Never stage Completed/Confirmed or click the appointment/payment Save form. */
export async function moveOnDailySchedule(page:Page,input:{appointmentId:string;truck:string;start?:number;duration?:number;expectedDate?:string},read:()=>Promise<DispatchSource>,openSchedule:(date:string)=>Promise<void>,reopen:()=>Promise<void>) {
  const before=await read();
  if(before.appointmentId!==input.appointmentId || /cancel/i.test(before.status)) throw new Error('Canceled appointments must be restored before dispatching.');
  if(input.expectedDate && input.expectedDate!==before.date) throw new Error('The source appointment date changed. Refresh before dispatching.');
  const start=input.start ?? before.start;
  if(input.duration!==undefined && input.duration!==before.duration) throw new Error('Dispatch moves preserve appointment duration. Reload the source window.');
  if(!Number.isInteger(start) || start<0 || start%60!==0 || start+before.duration*60>1440) throw new Error('A valid hourly dispatch window is required.');
  if(before.truck===input.truck && before.start===start) return {before,after:before,changed:false};
  await openSchedule(before.date);
  const target=await page.evaluate(({appointmentId,truck})=>{
    const appointment=document.getElementById(`aid-${appointmentId}`);
    if(!appointment?.classList.contains('draggable')) throw new Error('This appointment is not draggable in the source daily schedule.');
    const label=truck ? 'Truck# '+truck.match(/\d+/)?.[0] : 'Virtual Truck';
    const headers=Array.from(document.querySelectorAll<HTMLTableCellElement>('table.schedule-table th'));
    const header=headers.find(h=>(h.textContent || '').replace(/\s+/g,' ').trim()===label);
    const truckId=header?.querySelector<HTMLInputElement>('.truck-id')?.value || '';
    const userId=document.querySelector<HTMLInputElement>("[id$='UserIDHF']")?.value || '';
    if(!/^\d+$/.test(truckId) || !/^\d+$/.test(userId)) throw new Error('The requested JunkWare dispatch lane is unavailable.');
    return {truckId,userId};
  },input);
  let error='';
  try {
    await page.evaluate(async({appointmentId,truckId,startTime,userId})=>{
      const response=await fetch('/franchise/daily-schedule.aspx/MoveAppointment',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({appointmentId,truckId,startTime,userId})});
      if(!response.ok) throw new Error(`JunkWare dispatch returned ${response.status}.`);
    },{appointmentId:input.appointmentId,...target,startTime:`${String(Math.floor(start/60)).padStart(2,'0')}:${String(start%60).padStart(2,'0')}`});
  } catch(e) {error=e instanceof Error?e.message:'Move response unavailable.';}
  // One submission only, including a lost response; saved source is the authority.
  await reopen();
  const after=await read();
  if(after.appointmentId!==before.appointmentId || after.date!==before.date || after.truck!==input.truck || after.start!==start || after.duration!==before.duration || after.status!==before.status || JSON.stringify(after.protectedCloseout)!==JSON.stringify(before.protectedCloseout)) throw new Error(error || 'JunkWare did not verify the move with status and closeout preserved.');
  return {before,after,changed:true};
}
