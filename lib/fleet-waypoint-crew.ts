import { listCrewPhones } from './crew-phone-store';
import { readCrewDay } from './crew-phone-day';
import { listTruckInspections } from './truck-inspection-store';
import { chicagoDateKey } from './chicago-date';
import { sameTruck } from './junkware-trucks';
import type { CrewPhoneDay } from './crew-phone';
import type { TruckInspectionReport } from './truck-inspection';

type Setup = {label:string; day:CrewPhoneDay};
export type WaypointFleetCrew = {driver:string;navigator:string;crewMembers:string[];crewNote:string};
export function resolveWaypointFleetCrew(truck:string, setups:Setup[], reports:TruckInspectionReport[]):WaypointFleetCrew|null {
  const matching=setups.filter(row=>sameTruck(row.day.truck,truck));
  if(!matching.length)return null;
  const signatures=new Set(matching.map(({day})=>JSON.stringify([day.driver.trim().toLowerCase(),day.navigators.map(n=>n.trim().toLowerCase()).sort()])));
  const time=(value:string)=>new Date(value).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'});
  if(signatures.size>1)return {driver:'Crew conflict',navigator:'',crewMembers:[],crewNote:matching.map(({label,day})=>`${label}: ${day.driver} (driver)${day.navigators.length ? `, ${day.navigators.join(', ')} (navigator)` : ''}`).join(' · ')};
  const latest=matching.toSorted((a,b)=>b.day.savedAt.localeCompare(a.day.savedAt))[0];
  const inspections=reports.filter(r=>sameTruck(r.truck,truck) && r.inspectionDate===latest.day.date);
  const inspection=inspections.toSorted((a,b)=>b.receivedAt.localeCompare(a.receivedAt))[0];
  const status=inspections.some(r=>r.status==='stop')?'Do not operate inspection recorded':inspection?`Inspection received ${time(inspection.receivedAt)} CT · ${inspection.inspector}`:'Inspection not received';
  return {driver:latest.day.driver,navigator:latest.day.navigators.join(' · ') || '—',crewMembers:[latest.day.driver,...latest.day.navigators],crewNote:`Waypoint setup ${time(latest.day.savedAt)} CT · ${status}`};
}
export function readWaypointFleetCrews(date:string, trucks:string[], now=new Date()):Map<string,WaypointFleetCrew> {
  // Current phone setup describes today's crew, never historical job attribution.
  if(date!==chicagoDateKey(now))return new Map();
  try {
    const setups=listCrewPhones(now).filter(p=>p.state==='active' && p.access==='live').flatMap(phone=>{
      const day=readCrewDay(phone,date);return day?[{label:phone.label,day}]:[];
    });
    const reports=listTruckInspections(date);
    return new Map(trucks.flatMap(truck=>{const crew=resolveWaypointFleetCrew(truck,setups,reports);return crew?[[truck,crew] as const]:[];}));
  } catch {
    return new Map(trucks.map(truck=>[truck,{driver:'Crew unavailable',navigator:'',crewMembers:[],crewNote:'Waypoint setup or inspection records could not be read. Refresh to retry.'}]));
  }
}
