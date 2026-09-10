import type {OperationalAlert} from './operational-alert-presentation';
import {readOperationalTruckLoads, type OperationalTruckLoad} from './truck-load-closeouts';

/** Internal Command/Fleet exceptions only; this does not publish messages. */
export function truckLoadTrackingAlerts(date:string, loads:OperationalTruckLoad[]=readOperationalTruckLoads(date)):OperationalAlert[] {
  return loads.filter(load=>!load.events.length || load.isOverCapacity || load.unplacedAppointmentIds.length>0 || /not yet included|conflicting closeout|Unresolved carried load/.test(load.verificationNote)).map(load=>({
    id:`truck-load-tracking:${date}:${load.truck}`,source:'Truck load reconciliation',label:'Load tracking',domain:'Fleet',truck:load.truck,
    detected:date,title:`${load.truck}: ${!load.events.length ? 'load is unknown' : load.isOverCapacity ? 'load exceeds capacity' : 'load reconciliation needs attention'}`,
    facts:[{label:'Calculated load',value:load.displayLoadLabel},{label:'Issue',value:load.verificationNote || 'Recorded volume exceeds truck capacity. Verify the most recent unload and load reports.'}],
    owner:'Dispatch',next:!load.events.length?'Establish the current load once; subsequent jobs and unloads update it automatically.':'Review the identified job or unload; confirmed amounts remain visible.',
    href:`/desktop?data=live&workspace=Fleet&date=${date}&truck=${encodeURIComponent(load.truck)}`,needsAction:true,
  }));
}
