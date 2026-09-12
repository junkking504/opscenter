import type { Page } from '@playwright/test';
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
export async function openAppointmentDispatch(page:Page,appointmentId:string,date:string,openSchedule:(date:string)=>Promise<void>,targetTruck?:string) {
  await openSchedule(date);
  const filter='#ctl00_Content_ServiceProviderGroupLB';
  const groups=await page.locator(filter).evaluateAll(controls=>controls.flatMap(control=>Array.from((control as HTMLSelectElement).options).filter(option=>option.value).map(option=>({value:option.value,selected:option.selected}))));
  const hasAppointment=async()=>await page.locator(`#aid-${appointmentId}`).count()===1;
  const hasTarget=async()=>!targetTruck || page.locator('table.schedule-table th').evaluateAll((headers,truck)=>headers.some(header=>(header.textContent || '').replace(/\s+/g,' ').trim()===`Truck# ${truck.match(/\d+/)?.[0]}`),targetTruck);
  const applyGroups=async(values:string[])=>{
    await Promise.all([
      page.waitForNavigation({waitUntil:'domcontentloaded',timeout:30_000}),
      page.locator(filter).evaluate((element,values)=>{
        const select=element as HTMLSelectElement;
        const form=select.form;
        const button=document.querySelector<HTMLInputElement>('#ctl00_Content_SelectServiceProvidersBtn');
        const target=form?.elements.namedItem('__EVENTTARGET');
        if(!form || !button?.name || !(target instanceof HTMLInputElement)) throw new Error('JunkWare dispatch preflight: the franchise filter changed. No move was submitted.');
        for(const option of select.options)option.selected=values.includes(option.value);
        target.value=button.name;
        HTMLFormElement.prototype.submit.call(form);
      },values),
    ]);
    await openSchedule(date);
  };
  const includeDestination=async()=>{
    if(await hasTarget())return true;
    // A New Orleans appointment can be dispatched to a Jefferson Parish truck.
    // Keep the source appointment visible while exposing every destination lane.
    if(targetTruck && groups.length>1) {
      await applyGroups(groups.map(group=>group.value));
      if(await hasAppointment() && await hasTarget())return true;
    }
    throw new Error('JunkWare dispatch preflight: the requested truck lane is unavailable in the accessible franchises. No move was submitted.');
  };
  if(await hasAppointment() && (targetTruck || groups.filter(group=>group.selected).length<=1)) {await includeDestination();return;}
  const franchises=groups.sort((a,b)=>Number(b.selected)-Number(a.selected)).map(group=>group.value);
  for(const franchise of franchises) {
    await applyGroups([franchise]);
    if(await hasAppointment()) {await includeDestination();return;}
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
  await openAppointmentDispatch(page,input.appointmentId,before.date,openSchedule,input.truck);
  const target=await page.evaluate(({appointmentId,truck,keepVirtualLane})=>{
    const appointment=document.getElementById(`aid-${appointmentId}`);
    if(!appointment?.classList.contains('draggable')) throw new Error('This appointment is not draggable in the source daily schedule.');
    const label=truck ? 'Truck# '+truck.match(/\d+/)?.[0] : 'Virtual Truck';
    const headers=Array.from(appointment.closest('table.schedule-table')?.querySelectorAll<HTMLTableCellElement>('th') || []);
    const currentHeader=headers[appointment.closest('td')?.cellIndex ?? -1];
    const matches=headers.filter(h=>(h.textContent || '').replace(/\s+/g,' ').trim()===label);
    if(truck && new Set(matches.map(h=>h.querySelector<HTMLInputElement>('.truck-id')?.value)).size>1) throw new Error('JunkWare dispatch preflight: the requested truck lane is ambiguous. No move was submitted.');
    const header=keepVirtualLane && /virtual truck/i.test(currentHeader?.textContent || '') ? currentHeader : headers.find(h=>(h.textContent || '').replace(/\s+/g,' ').trim()===label);
    const truckId=header?.querySelector<HTMLInputElement>('.truck-id')?.value || '';
    const userId=document.querySelector<HTMLInputElement>("[id$='UserIDHF']")?.value || '';
    if(!/^\d+$/.test(truckId) || !/^\d+$/.test(userId)) throw new Error('JunkWare dispatch preflight: the requested lane or dispatcher identity is unavailable. No move was submitted.');
    return {truckId,userId};
  },{...input,keepVirtualLane:!before.truck && !input.truck});
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
