import type { Page } from '@playwright/test';
import {selectWithWebFormsPostback} from './junkware-webforms';
export async function readSavedDispatchTruck(page:Page):Promise<string> {
  const select=page.locator('#ctl00_Content_TruckDD');
  if(await select.count()!==1) throw new Error('The JunkWare truck assignment control has changed.');
  return select.evaluate(element=>{
    const control=element as HTMLSelectElement;
    const text=control.parentElement?.innerText || control.parentElement?.textContent || '';
    const assigned=text.match(/Assigned:\s*(Truck#?\s*\d+)/i);
    const completed=/complete|closed/i.test(document.querySelector<HTMLSelectElement>('#ctl00_Content_StatusDD')?.selectedOptions[0]?.textContent || '');
    // Completed records omit the separate dispatch-assignment label. Their saved
    // truck is the selected option; open records can select a different truck
    // while the Assigned label still identifies their actual dispatch lane.
    const label=assigned?.[1] || (completed ? control.selectedOptions[0]?.textContent || '' : '');
    const number=label.match(/truck\s*#?\s*(\d+)/i)?.[1];
    return number ? `Truck ${number}` : '';
  });
}
export type DispatchSource = {appointmentId:string;date:string;truck:string;start:number;duration:number;status:string;protectedCloseout:unknown};
export async function openAppointmentDispatch(page:Page,appointmentId:string,date:string,openSchedule:(date:string)=>Promise<void>) {
  await openSchedule(date);
  if(await page.locator(`#aid-${appointmentId}`).count()) return;
  const franchises=await page.locator('#ctl00_FranchiseDD').evaluateAll(controls=>controls.flatMap(control=>Array.from((control as HTMLSelectElement).options).filter(option=>option.value && !option.selected).map(option=>option.value)));
  for(const franchise of franchises) {
    await selectWithWebFormsPostback(page,'#ctl00_FranchiseDD',franchise,'the dispatch franchise');
    await openSchedule(date);
    if(await page.locator(`#aid-${appointmentId}`).count()) return;
  }
  throw new Error('JunkWare dispatch preflight: this appointment was not found on its saved day. No move was submitted.');
}
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
  await openAppointmentDispatch(page,input.appointmentId,before.date,openSchedule);
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
