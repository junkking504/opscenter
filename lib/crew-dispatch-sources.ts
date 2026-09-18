import fs from 'node:fs/promises';
import path from 'node:path';
import { readDesktopSchedule } from './desktop-schedule';
import { readScheduleReceipt } from './desktop-schedule-operations';
import { readJunkwareTruckAssignment } from './junkware-truck-assignment';
import { junkwareJobCloseout } from './junkware-job-closeout';
import { withJunkwareAppointmentSyncLock } from './job-route-assignments';
import type { CrewDispatchSources, DispatchReceipt } from './crew-dispatch-service';

export const crewDispatchSources: CrewDispatchSources = {
  schedule: readDesktopSchedule,
  async receipts(current) {
    const dir = process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR || path.join(process.cwd(),'data','desktop-operations');
    let files:string[];
    try { files=await fs.readdir(dir); }
    catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
    const receipts:DispatchReceipt[]=[];
    for(const file of files) {
      if(!/^[a-f0-9-]{36}\.json$/i.test(file))continue;
      const receipt=await readScheduleReceipt(file.slice(0,-5));
      if(receipt?.action==='closeout' && receipt.recordId===`${current.date}:appointment:${current.appointmentId}`) receipts.push(receipt as DispatchReceipt);
    }
    return receipts;
  },
  assignment: id=>withJunkwareAppointmentSyncLock(id,()=>readJunkwareTruckAssignment(id)),
  closeout: id=>withJunkwareAppointmentSyncLock(id,()=>junkwareJobCloseout(id)),
};
