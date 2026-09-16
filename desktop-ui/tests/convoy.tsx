import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LiveFleet from '../live-fleet';
import { convoyTabs } from '../lib/convoy-presentation';
import type { DesktopFleetSnapshot, FleetView } from '../lib/people-fleet-contract';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';

const date='2026-09-16';
const check={version:'fixture',inspector:'Example inspector',definitions:[{itemId:'tires',label:'Tires',guidance:'Check all tires'}],answers:[{itemId:'tires',status:'pass',notes:''}]};
const snapshot:DesktopFleetSnapshot={date,report:'overview',canWrite:true,sourceAvailable:true,sourceUpdatedAt:new Date().toISOString(),reportCoverageDays:15,warnings:['Truck# 4: load reconciliation needs attention. Check the pickup order.'],
  trucks:[1,2,3,4,6,7,8,9].map(id=>({id:`Truck# ${id}`,label:`Truck# ${id}`,vehicle:'Example truck',readiness:id===4?'Out of service':[1,2,7].includes(id)?'Attention':'Ready',operatingStatus:'Parked',driver:'Example driver',navigator:'Not assigned',assignment:'None',location:'Unavailable',gpsAt:null,gpsFreshness:'GPS unavailable',odometer:'Unavailable',serviceStatus:'Unavailable',nextService:'No source target',checklist:[1,7].includes(id)?'Missing':'Complete',loadPercent:id===2?50:0,loadLabel:id===2?'1/2 full':'Empty · provisional',loadNeedsVerification:id===4,loadNote:'Example inspection and load evidence',loadVersion:'fixture',checklistVersion:'fixture',checklists:{daily:check,weekly:check,monthly:check},checklistDefinitions:check.definitions,answers:check.answers,jobs:2,revenue:400,miles:null,idleMinutes:null,driverScore:null})),
  issues:[{issueId:'repair-4',truck:'Truck# 4',title:'Tire replacement',description:'Example tire issue',severity:'out_of_service',status:'open',owner:'Existing shop',dueDate:'2026-09-18',resolution:'',cost:null,downtimeHours:null,updatedAt:date,version:'fixture'} ,{issueId:'repair-2',truck:'Truck# 2',title:'Replace mirror',description:'Replacement part ordered',severity:'repair_soon',status:'in_progress',owner:'',dueDate:'',resolution:'',cost:null,downtimeHours:null,updatedAt:date,version:'fixture'},{issueId:'resolved-4',truck:'Truck# 4',title:'Tail light',description:'',severity:'monitor',status:'resolved',owner:'',dueDate:'',resolution:'Bulb replaced',cost:20,downtimeHours:0,updatedAt:date,version:'fixture'}],maintenance:[],reportRows:[{truck:'Truck 4',jobsCompleted:2,revenue:400,miles:12,idleTimeMinutes:0,averageDriverScore:null}],drivingScores:[]};
const receipts=new Map<string,unknown>();
window.fetch=async(input,init)=>{
 const url=new URL(String(input),location.origin);
 if(url.pathname!=='/api/desktop/fleet')return Response.json({});
 if(init?.method==='POST'){
  const request=JSON.parse(String(init.body));
  const receipt={status:'verified',requestId:request.requestId};receipts.set(request.requestId,receipt);
  if(request.action==='maintenance')snapshot.maintenance.push({recordId:request.requestId,truck:request.truck,...request.values,odometer:null,cost:null,nextServiceOdometer:null,version:'fixture-new'});
  if(request.action==='issue_delete')snapshot.issues=snapshot.issues.filter(issue=>issue.issueId!==request.values.issueId);
  if(request.action==='issue')snapshot.issues=snapshot.issues.map(issue=>issue.issueId===request.values.issueId?{...issue,...request.values,version:'fixture-new'}:issue);
  if(request.action==='load_snapshot')snapshot.trucks=snapshot.trucks.map(truck=>truck.id===request.truck?{...truck,loadPercent:request.values.loadFraction*100,loadLabel:`${request.values.loadFraction*100}% full`,loadNeedsVerification:false,loadVersion:'fixture-new'}:truck);
  return Response.json({receipt});
 }
 if(url.searchParams.has('receipt'))return Response.json({receipt:receipts.get(url.searchParams.get('receipt')||'')});
 return Response.json(snapshot);
};
function Fixture(){const[view,setView]=useState<FleetView>('overview');return <main className="ops-live" style={{padding:16}}><h1>Convoy · synthetic data only</h1><nav className="workspace-tabs convoy-tabs" role="tablist" aria-label="Convoy views">{convoyTabs.map(([key,label])=><button key={key} role="tab" aria-selected={view===key} onClick={()=>setView(key)}>{label}</button>)}</nav><LiveFleet date={date} view={view} onViewChange={setView}/></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
