import React from 'react';
import { createRoot } from 'react-dom/client';
import MaintenanceMonitor from '../maintenance-monitor';
import MaintenanceNotice from '../maintenance-notice';
import type { MaintenanceSnapshot } from '../lib/maintenance-contract';
const at=new Date().toISOString();
const snapshot:MaintenanceSnapshot={available:true,fresh:true,checkedAt:at,mode:'observe',aiStatus:'AI unavailable: HTTP 429 (provider reason unavailable); monitoring continues',month:'2026-09',budgetUsd:10,committedUsd:0.67,estimatedUsd:0.05,calls:214,canVerify:true,clientFailureTimes:{'schedule-closeout':Date.parse(at)},incidents:[
 {key:'client-schedule-closeout',title:'Appointment closeout failure',area:'Schedule',kind:'technical',unhealthy:false,evidence:'POST Appointment closeout: http (HTTP 503). 1 report(s).',nextStep:'Reproduce this specific interaction and verify its result. Then mark the interaction verified. Silence does not establish recovery.',status:'verification-needed',firstSeenAt:at,lastSeenAt:at,resolvedAt:null,badChecks:0,goodChecks:0,occurrences:1,attempts:0},
 {key:'signal-gpsCoverage',title:'Tracker coverage',area:'Fleet',kind:'technical',unhealthy:true,evidence:'Tracker coverage: critical. mappedTrackers: 6; reportingTrackers: 4',nextStep:'Inspect tracker coverage in Fleet.',status:'open',firstSeenAt:at,lastSeenAt:at,resolvedAt:null,badChecks:3,goodChecks:0,occurrences:1,attempts:1},
]};
window.fetch=async(input,init)=>{
 if(String(input)==='/api/desktop/maintenance')return Response.json(snapshot);
 if(String(input)==='/api/desktop/maintenance/verify'&&init?.method==='POST'){
  const body=JSON.parse(String(init.body));
  return new Response(null,{status:body.category==='schedule-closeout'&&body.failureAt===Date.parse(at)?202:409});
 }
 throw new Error('Fixture permits no external requests');
};
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1100,margin:'20px auto',fontFamily:'system-ui',padding:16}}><h1>Synthetic maintenance verification</h1><MaintenanceNotice onOpen={()=>document.getElementById('maintenance-title')?.scrollIntoView()}/><MaintenanceMonitor/></main>);
