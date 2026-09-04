import fs from 'node:fs';
import path from 'node:path';
import { buildFleetMapPayload } from '@/lib/fleet-map';
import { buildFleetMonthlySummary } from '@/lib/fleet-history';
import { readFleetMaintenanceStore, upsertFleetMaintenanceRecord } from '@/lib/fleet-maintenance';
import { readFleetIssueStore, upsertFleetIssue, syncFleetIssuesFromChecklist } from '@/lib/fleet-issues';
import { readFleetChecklistStore, upsertFleetChecklist } from '@/lib/fleet-checklists';
import { effectiveFleetChecklistDefinitions, fleetChecklistPeriodKey, type FleetChecklistCadence } from '@/lib/fleet-checklist-definitions';
import { readFleetChecklistTemplateStore } from '@/lib/fleet-checklist-templates';
import { readTruckLoadStatuses, resetTruckLoad, setTruckStartingLoad, recordTruckLoadSnapshot } from '@/lib/truck-load-status';
import { opsRoleCan, type InteractiveOpsRole } from '@/lib/ops-roles';
import { desktopVersion, executeDesktopLocalAction } from '@/lib/desktop-krewe';
import { validDesktopDate, type DesktopFleetSnapshot } from '../desktop-ui/lib/people-fleet-contract';

export function readDesktopFleet(date:string, report:string, role:InteractiveOpsRole):DesktopFleetSnapshot {
  if(!validDesktopDate(date)) throw new Error('A valid operating date is required.');
  const issueFile=path.join(process.cwd(),'data','fleet','repair_issues.json'); const issuesAvailable=fs.existsSync(issueFile); if(issuesAvailable){const raw=JSON.parse(fs.readFileSync(issueFile,'utf8'));if(!Array.isArray(raw.issues))throw new Error('Repair source is incomplete.');}
  const map=buildFleetMapPayload(date); const issues=readFleetIssueStore().issues; const maintenance=readFleetMaintenanceStore().records; const entries=readFleetChecklistStore().entries; const customizations=readFleetChecklistTemplateStore().customizations;
  const names=[...new Set([...(map?.trucks.map(row=>row.truck)||[]),...issues.map(row=>row.truck),...maintenance.map(row=>row.truck),...entries.map(row=>row.truck)])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const loads=readTruckLoadStatuses(date,names); const summary=report==='reports'?buildFleetMonthlySummary(date):null;
  return {date,report,sourceUpdatedAt:map?.lastUpdatedAt||null,sourceAvailable:Boolean(map),canWrite:opsRoleCan(role,'operations.write'),trucks:names.map(name=>{
    const source=map?.trucks.find(row=>row.truck===name); const checklist=entries.find(row=>row.truck===name&&row.cadence==='daily'&&row.periodKey===date)||null; const load=loads.find(row=>row.truck===name)||null; const repairs=issues.filter(row=>row.truck===name&&row.status!=='resolved'); const definitions=effectiveFleetChecklistDefinitions(name,'daily',customizations);
    const checklistFor=(cadence:FleetChecklistCadence)=>{const entry=entries.find(row=>row.truck===name&&row.cadence===cadence&&row.periodKey===fleetChecklistPeriodKey(date,cadence))||null;return {version:desktopVersion(entry),inspector:entry?.inspector||'',definitions:effectiveFleetChecklistDefinitions(name,cadence,customizations),answers:entry?.answers||[]};};
    const complete=Boolean(checklist?.completedAt&&checklist.inspector&&definitions.every(def=>checklist.answers.some(answer=>answer.itemId===def.itemId)));
    return {id:name,label:name,vehicle:source?.yearMakeModel||source?.vehicleName||'Unavailable',readiness:!issuesAvailable?'Unavailable':repairs.some(row=>row.severity==='out_of_service')?'Out of service':!complete||repairs.length?'Attention':'Ready',operatingStatus:source?.operationalStatus||'Unavailable',driver:source?.driver||'Unassigned',navigator:source?.navigator||'Unassigned',assignment:source?.currentOrHistoricalAppointment||'Unavailable',location:source?.hasCoordinates?`${source.latitude?.toFixed(4)}, ${source.longitude?.toFixed(4)}`:'Unavailable',gpsAt:source?.lastGpsUpdate||null,gpsFreshness:source?.freshnessLabel||'Unavailable',odometer:source?.odometer||'Unavailable',serviceStatus:source?.serviceStatus||'Unavailable',nextService:[source?.mileageUntilNextService,source?.daysUntilNextService].filter(Boolean).join(' · ')||'No source target',checklist:complete?'Complete':'Missing',loadPercent:load?.events.length?load.capacityPercent:null,loadNote:load?.lastEvent?load.currentContents||load.currentLoadLabel:'No load observation recorded',loadVersion:desktopVersion(load),checklistVersion:desktopVersion(checklist),checklists:{daily:checklistFor('daily'),weekly:checklistFor('weekly'),monthly:checklistFor('monthly')},checklistDefinitions:definitions,answers:checklist?.answers||[],jobs:source?.jobsCompleted??null,revenue:source?.revenue??null,miles:source?.milesDriven??null,idleMinutes:null,driverScore:source?.driverScore??null};
  }),issues:issues.map(row=>({...row,version:desktopVersion(row)})),maintenance:maintenance.map(row=>({...row,version:desktopVersion(row)})),reportRows:summary?.truckRows||[],reportCoverageDays:summary?.coverageDays||0,warnings:[...(!issuesAvailable?['Repair source is unavailable. Inspection completion alone does not establish readiness.']:[]),...(map?.mappingWarnings||[]),...(!map?['Fleet telemetry source is unavailable. Stored maintenance records do not establish current GPS status.']:[]),...(report==='reports'?['Report totals include available daily observations only; coverage days are shown.']:[])]};
}
export function runDesktopFleetAction(body:Record<string,unknown>,actor:string,role:InteractiveOpsRole) {
  if(!opsRoleCan(role,'operations.write')) throw new Error('Your role cannot update Fleet.');
  const date=String(body.date||'');const truck=String(body.truck||'');const action=String(body.action||'');const values=(body.values||{}) as Record<string,unknown>;
  if(!validDesktopDate(date)||!/^Truck#?\s*\d+$/.test(truck)||!['maintenance','issue','checklist','load_start','load_reset','load_snapshot'].includes(action)) throw new Error('A valid truck, date, and action are required.');
  if(!readDesktopFleet(date,'overview',role).trucks.some(row=>row.id===truck)) throw new Error('Truck is not present in current source records.');
  const cadence=String(values.cadence||'daily') as FleetChecklistCadence; if(action==='checklist'&&!['daily','weekly','monthly'].includes(cadence)) throw new Error('Choose a valid checklist frequency.');
  const recordId=String(values.recordId||'');const issueId=String(values.issueId||'');
  const current=()=>action==='maintenance'?readFleetMaintenanceStore().records.find(row=>row.recordId===recordId)||null:action==='issue'?readFleetIssueStore().issues.find(row=>row.issueId===issueId)||null:action==='checklist'?readFleetChecklistStore().entries.find(row=>row.truck===truck&&row.cadence===cadence&&row.periodKey===fleetChecklistPeriodKey(date,cadence))||null:readTruckLoadStatuses(date,[truck])[0]||null;
  const source=current(); if(source && 'truck' in source && source.truck!==truck) throw new Error('Record belongs to another truck.');
  if(action==='issue' && values.status==='resolved'&&!String(values.resolution||'').trim()) throw new Error('A resolution is required before closing a repair.');
  if(action==='maintenance'&&(!validDesktopDate(String(values.serviceDate||date))||!String(values.serviceType||'').trim()||!['scheduled','completed'].includes(String(values.status)))) throw new Error('Service date, type, and status are required.');
  if(action==='load_reset'&&!['dump','metal_yard'].includes(String(values.location))) throw new Error('Choose a verified dump or metal-yard reset.');
  if(action==='load_snapshot'&&(!Number.isFinite(Number(values.loadFraction))||Number(values.loadFraction)<0||Number(values.loadFraction)>2||!String(values.contents||'').trim())) throw new Error('A current load observation and contents note are required.');
  if(action==='load_start'&&(!Number.isFinite(Number(values.loadFraction))||Number(values.loadFraction)<0||Number(values.loadFraction)>1)) throw new Error('Starting load must be between zero and one full truck.');
  if(action==='checklist') {
    const answers=Array.isArray(values.answers)?values.answers as Array<Record<string,unknown>>:[]; const definitions=effectiveFleetChecklistDefinitions(truck,cadence,readFleetChecklistTemplateStore().customizations);
    if(!String(values.inspector||'').trim()||!definitions.every(def=>answers.some(answer=>answer.itemId===def.itemId&&['pass','attention','na'].includes(String(answer.status))))) throw new Error('Answer every inspection item and provide the inspector name.');
  }
  return executeDesktopLocalAction({requestId:String(body.requestId||''),action:`fleet.${action}`,entity:`fleet:${truck}:${action.startsWith('load')?'load':action}:${action==='maintenance'||action==='issue'?'records':action==='checklist'?`${cadence}:${fleetChecklistPeriodKey(date,cadence)}`:date}`,expectedVersion:String(body.expectedVersion||''),values},actor,current,()=>{
    if(action==='maintenance') return upsertFleetMaintenanceRecord({recordId:recordId||`desktop-${body.requestId}`,truck,serviceDate:String(values.serviceDate||date),status:String(values.status),serviceType:String(values.serviceType),description:String(values.description||''),odometer:values.odometer,cost:values.cost,vendor:String(values.vendor||''),nextServiceDate:String(values.nextServiceDate||''),nextServiceOdometer:values.nextServiceOdometer,notes:String(values.notes||'')});
    if(action==='issue') return upsertFleetIssue({...values,issueId:issueId||`desktop-${body.requestId}`,truck});
    if(action==='checklist'){const entry=upsertFleetChecklist({truck,cadence,inspectionDate:date,inspector:String(values.inspector),odometer:values.odometer,answers:values.answers,submittedByEmail:actor});if(entry)syncFleetIssuesFromChecklist(entry);return entry;}
    if(action==='load_snapshot') return recordTruckLoadSnapshot({date,truck,loadFraction:values.loadFraction,contents:String(values.contents),messageId:`desktop-${body.requestId}`,recordedBy:actor}).status;
    if(action==='load_start') return setTruckStartingLoad({date,truck,loadFraction:values.loadFraction,recordedBy:actor});
    return resetTruckLoad({date,truck,location:String(values.location) as 'dump'|'metal_yard',recordedBy:actor,eventId:String(body.requestId)});
  },result=>{
    if(action==='maintenance') return readFleetMaintenanceStore().records.some(row=>desktopVersion(row)===desktopVersion(result));
    if(action==='issue') return readFleetIssueStore().issues.some(row=>desktopVersion(row)===desktopVersion(result));
    return desktopVersion(current())===desktopVersion(result);
  });
}
