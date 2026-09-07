import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import LiveKrewe from '../live-krewe';
import type {DesktopCrewMember,DesktopKreweSnapshot,CrewAmounts} from '../lib/people-fleet-contract';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';

// Isolated browser fixture: every application request is intercepted in memory.
// These writes never reach OpsCenter, JunkWare, or an employee's payroll store.
const mode=new URLSearchParams(location.search).get('mode') || 'normal';
const anchor='2026-09-05';
const dates=Array.from({length:14},(_,i)=>new Date(Date.UTC(2026,7,24+i)).toISOString().slice(0,10));
const empty: CrewAmounts={hours:null,regularHours:null,overtimeHours:null,jobs:null,revenue:null,labor:null,tips:null,bonuses:null,supplemental:null,totalPay:null};
const amounts:CrewAmounts={hours:8,regularHours:8,overtimeHours:0,jobs:2,revenue:200,labor:160,tips:10,bonuses:0,supplemental:0,totalPay:170};
const base:DesktopCrewMember={...amounts,id:'sample crew',name:'Sample Crew',initials:'SC',role:'Driver',truck:'Truck 1',working:true,clockIn:'8:00 AM',clockOut:'4:00 PM',hourlyRate:20,status:'Clocked out',issue:'',version:'a'.repeat(64),actionVersions:{correction:'a'.repeat(64),bonus:'b'.repeat(64)},correction:null,days:[]};
const corrections=new Map<string,{clockIn:string;clockOut:string;hourlyRate:number;note:string}>();
const bonuses=new Map<string,Array<{entryId:string;amount:number;note:string}>>();
const receipts=new Map<string,string>();
const requests:Array<{date:string;action:string;name:string;expectedVersion:string}>=[];
const missingDate='2026-08-26';
const dayMember=(date:string):DesktopCrewMember=>{
  const correction=corrections.get(date);
  const missing=date===missingDate;
  return {...base,...(missing?{...empty,clockIn:'',clockOut:'',hourlyRate:null,status:'No record for this day'}:{}),...(correction?{...correction,status:'Clocked out',correction:{...correction,updatedBy:'Synthetic manager',updatedAt:'2026-09-07T12:00:00Z'},actionVersions:{correction:'c'.repeat(64),bonus:'b'.repeat(64)}}:{}),days:[]};
};
const toMinutes=(time:string)=>{const match=time.match(/(\d+):(\d+)\s*(AM|PM)/i);return match?(Number(match[1])%12+(match[3].toUpperCase()==='PM'?12:0))*60+Number(match[2]):0;};
function snapshot(date:string,view:string):DesktopKreweSnapshot {
  const member={...base,days:dates.filter(day=>day!==missingDate).map(day=>({...amounts,date:day,clockIn:base.clockIn,clockOut:base.clockOut}))};
  const members=view==='today'?(mode==='holiday'?[]:[{...dayMember(date),days:[{...amounts,date,clockIn:base.clockIn,clockOut:base.clockOut}]}, {...base,id:'open crew',name:'Open Crew',clockOut:'',status:'Clocked in'}]):[member];
  return {date,view:view as DesktopKreweSnapshot['view'],start:view==='today'?date:dates[0],end:view==='today'?date:dates[13],sourceUpdatedAt:new Date().toISOString(),missingDates:[],payrollVisible:true,canWrite:mode!=='readonly',members,totals:members.length?amounts:empty,callIn:null};
}
window.fetch=async(input,init)=>{
  const url=new URL(String(input),location.origin),date=url.searchParams.get('date') || anchor;
  if(init?.method==='POST') {
    const body=JSON.parse(String(init.body));
    requests.push({date:body.date,action:body.action,name:body.name,expectedVersion:body.expectedVersion});
    window.dispatchEvent(new Event('fixture-write'));
    if(mode==='stale') return Response.json({error:'This record changed. Refresh and review the current values.'},{status:409});
    if(body.action==='correction') corrections.set(body.date,body.values);
    else bonuses.set(body.date,[...(bonuses.get(body.date)||[]),{entryId:body.requestId,...body.values}]);
    receipts.set(body.requestId,'verified');
    if(mode==='lost') throw new TypeError('Synthetic lost response after save');
    return Response.json({receipt:{status:'verified'}});
  }
  if(url.pathname==='/api/desktop/krewe/hours') return Response.json({date,start:dates[0],end:dates[13],generatedAt:new Date().toISOString(),missingDates:[],employees:[{id:base.id,name:base.name,total:dates.reduce((sum,day)=>sum+(corrections.has(day)?(toMinutes(dayMember(day).clockOut)-toMinutes(dayMember(day).clockIn))/60:day===missingDate?0:8),0),weeks:[0,7].map(offset=>{
    const days=dates.slice(offset,offset+7).map(day=>{const member=dayMember(day); const h=corrections.has(day)?(toMinutes(member.clockOut)-toMinutes(member.clockIn))/60:day===missingDate?null:8;return {date:day,hours:h,regular:h||0,overtime:0,clockIn:member.clockIn,clockOut:member.clockOut,corrected:corrections.has(day),role:member.role,truck:member.truck,jobs:member.jobs,jobRevenueWorked:member.revenue,status:h===null?'No Record':'Recorded'};});
    const total=days.reduce((sum,day)=>sum+(day.hours||0),0);return {start:dates[offset],end:dates[offset+6],total,regular:Math.min(40,total),overtime:Math.max(0,total-40),incomplete:days.some(day=>day.hours===null),days};
  })}]});
  if(url.pathname==='/api/desktop/krewe') {
    if(url.searchParams.has('receipt'))return Response.json({receipt:{status:receipts.get(url.searchParams.get('receipt')!)||'uncertain'}});
    if(url.searchParams.has('employee'))return Response.json({date,canWrite:mode!=='readonly',member:dayMember(date),manualBonuses:bonuses.get(date)||[]});
    return Response.json(snapshot(date,url.searchParams.get('view')||'today'));
  }
  return Response.json({error:'No source requests are allowed in this fixture.'},{status:503});
};
function Fixture(){
  const [view,setView]=useState<'today'|'payperiod'>('payperiod');
  const [busy,setBusy]=useState(false);
  const [,setVersion]=useState(0);
  useEffect(()=>{const update=()=>setVersion(value=>value+1);window.addEventListener('fixture-write',update);return()=>window.removeEventListener('fixture-write',update);},[]);
  return <main style={{padding:16,maxWidth:1250,margin:'auto'}}><h1>Krewe local check · synthetic data</h1><p>Scenario: {mode}. Global selected date: {anchor}.</p><nav><button disabled={busy} onClick={()=>setView('today')}>Today</button> · <button disabled={busy} onClick={()=>setView('payperiod')}>Pay Period</button></nav><p role="status">Writes: {requests.length}{requests.length?` · Last action: ${requests.at(-1)!.action} · ${requests.at(-1)!.date}`:''}</p><LiveKrewe date={mode==='holiday'&&view==='today'?'2026-09-07':anchor} view={view} onBusyChange={setBusy}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
