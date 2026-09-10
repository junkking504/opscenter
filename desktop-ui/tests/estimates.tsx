import React from 'react';
import { createRoot } from 'react-dom/client';
import Estimates, { EstimateCommandSummary } from '../estimates';
import { estimateSummary, type EstimateSnapshot, type EstimateRow, type EstimateChange, type EstimateEvent } from '../lib/estimate-contract';
import '../app/globals.css';
const followup={status:'verify_booking' as const,owner:'',nextFollowup:'',reason:'',lastContactAt:null};
const row=(id:string,extra:Partial<EstimateRow>={}):EstimateRow=>({id,jk:`JK${id}`,customer:`Synthetic customer ${id}`,phone:'504-555-0100',email:'test@example.test',address:'100 Example Street, New Orleans LA',territory:'New Orleans',date:'2026-09-08',quote:1200,observedAt:'2026-09-10T12:00:00Z',sourceStatus:'Completed',notes:['Waiting on customer approval.'],photos:[],pricing:'1 × Full truck',status:'verify_booking',followup,history:[],tracked:false,bookings:[],canceledBookings:[],possibleBookings:[],version:'a'.repeat(64),ageDays:2,overdue:false,dueToday:false,...extra});
const initial:EstimateSnapshot={today:'2026-09-10',generatedAt:'2026-09-10T16:00:00Z',recentStart:'2026-08-01',coverage:{files:42,unreadable:0,latestObservation:'2026-09-10T12:00:00Z'},canWrite:true,actor:'Synthetic Operator',rows:[row('100',{customer:'Zebra customer',quote:0,date:'2026-09-09',ageDays:1}),row('101',{status:'converted',bookings:[{id:'201',jk:'JK201',date:'2026-09-12',status:'Confirmed',observedAt:'2026-09-10T12:00:00Z'}]}),row('102',{status:'lost',tracked:true,followup:{...followup,status:'lost',reason:'Customer no longer needs removal.'}}),row('103',{status:'waiting',tracked:true,followup:{...followup,status:'waiting',owner:'Synthetic Owner',nextFollowup:'2026-09-09',reason:'Approval expected tomorrow'},overdue:true}),row('104',{date:'2025-01-01',quote:null,ageDays:617}),row('105',{customer:'Alpha customer',quote:2500,followup:{...followup,nextFollowup:'2026-09-15'},possibleBookings:[{id:'205',jk:'JK205',date:'2026-09-12',status:'Confirmed',observedAt:'2026-09-10T12:00:00Z'}]})]};
let data=JSON.parse(sessionStorage.getItem('estimate-fixture') || 'null') as EstimateSnapshot | null;data ||= structuredClone(initial);
let mode='normal';
window.fetch=async(input,init)=>{
  if(String(input)!=='/api/desktop/estimates')throw new Error('Fixture only');
  if(mode==='unavailable')return Response.json({error:'Synthetic source unavailable'},{status:503});
  if(init?.method!=='POST')return Response.json(data);
  if(mode==='conflict')return Response.json({error:'The estimate changed. Reload and review before saving.'},{status:409});
  const change=JSON.parse(String(init.body)) as EstimateChange;
  const row=data!.rows.find(row=>row.id===change.id)!;
  const existing=row.history.find(event=>event.requestId===change.requestId);
  if(existing)return Response.json({verified:true,event:existing});
  const event:EstimateEvent={requestId:change.requestId,fingerprint:'fixture',actor:'Synthetic Operator',at:'2026-09-10T16:00:00Z',before:row.followup,after:{status:change.status,owner:change.owner,nextFollowup:change.status==='lost'?'':change.nextFollowup,reason:change.reason,lastContactAt:change.contacted?'2026-09-10T16:00:00Z':row.followup.lastContactAt},note:change.note,contacted:change.contacted};
  row.history.push(event);row.followup=event.after;row.status=event.after.status;row.tracked=true;row.version='b'.repeat(64);row.overdue=false;row.dueToday=event.after.nextFollowup==='2026-09-10';
  sessionStorage.setItem('estimate-fixture',JSON.stringify(data));
  if(mode==='uncertain'){mode='normal';throw new Error('Simulated dropped response after save');}
  return Response.json({verified:true,event});
};
function App(){return <main style={{padding:16}}><div style={{display:'flex',gap:12,flexWrap:'wrap',padding:10,fontSize:13}}><strong>Synthetic estimate QA · no live operations</strong><button onClick={()=>{sessionStorage.removeItem('estimate-fixture');location.reload();}}>Reset fixture</button><button onClick={()=>{mode='conflict';}}>Next save conflict</button><button onClick={()=>{mode='uncertain';}}>Drop next save response</button><button onClick={()=>{mode='unavailable';}}>Source unavailable</button><button onClick={()=>{mode='normal';}}>Source recovered</button></div><EstimateCommandSummary summary={estimateSummary(data!)} /><Estimates /></main>;}
createRoot(document.getElementById('root')!).render(<App/>);
