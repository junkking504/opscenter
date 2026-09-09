import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import LiveKreweHours from '../live-krewe-hours';
import type { DesktopCrewMember, DesktopKreweSnapshot, CrewAmounts } from '../lib/people-fleet-contract';
import type { KreweHoursSnapshot } from '../lib/krewe-hours-contract';
import '../app/globals.css';
const date='2026-09-05', start='2026-08-24', end='2026-09-06';
const days=Array.from({length:14},(_,i)=>new Date(Date.UTC(2026,7,24+i)).toISOString().slice(0,10));
const amounts:CrewAmounts={hours:4,regularHours:4,overtimeHours:0,jobs:1,revenue:200,labor:80,tips:10,bonuses:5,supplemental:0,totalPay:95};
function Fixture(){
 const [changed,setChanged]=useState(false),[failed,setFailed]=useState(false),[sourceOpen,setSourceOpen]=useState('');
 const members:DesktopCrewMember[]=['Sample Crew','Flagged Crew'].map((name,i)=>({...amounts,id:name.toLowerCase(),name,initials:'SC',role:'Driver',truck:'Truck 1',working:true,clockIn:'8:00 AM',clockOut:'12:00 PM',hourlyRate:20,status:'Clocked out',issue:'',version:'a',correction:null,days:days.map((date,index)=>({...amounts,date,clockIn:'8:00 AM',clockOut:'12:00 PM',bonuses:5+(changed&&!i&&!index?1:0),totalPay:95+(changed&&!i&&!index?1:0),tips:i===1&&index===1?null:10,sourceAt:'2026-09-07T12:00:00Z',manualBonuses:[{entryId:`${date}-${i}`,amount:5,note:'Synthetic manual bonus'}]}))}));
 const hours:KreweHoursSnapshot={date,start,end,generatedAt:'2026-09-07T13:00:00Z',missingDates:[],employees:members.map(member=>({id:member.id,name:member.name,total:56,weeks:[0,7].map(offset=>({start:days[offset],end:days[offset+6],total:28,regular:28,overtime:0,incomplete:false,days:days.slice(offset,offset+7).map(date=>({date,hours:4,regular:4,overtime:0,clockIn:'8:00 AM',clockOut:'12:00 PM',corrected:false,role:'Driver',truck:'Truck 1',jobs:1,jobRevenueWorked:200,status:'Recorded' as const}))}))}))};
 const payroll:DesktopKreweSnapshot={date,start,end,view:'payperiod',sourceUpdatedAt:'2026-09-07T12:00:00Z',missingDates:[],payrollVisible:true,canWrite:false,members,totals:amounts,callIn:null,hoursSnapshot:hours};
 return <main style={{padding:20,maxWidth:1400,margin:'auto'}}><h1>Synthetic payroll review</h1><p>All records are fictional. This fixture makes no source requests.</p><button onClick={()=>setChanged(value=>!value)}>Change source bonus</button> · <button onClick={()=>setFailed(value=>!value)}>Toggle refresh failure</button><p>{sourceOpen}</p><LiveKreweHours date={date} payroll={payroll} sourceError={failed?'Synthetic refresh failure':''} onRefresh={()=>setSourceOpen('Snapshot refreshed')}/></main>;
}
window.fetch=async()=>{throw new Error('External requests are disabled in this fixture.');};
createRoot(document.getElementById('root')!).render(<Fixture/>);
