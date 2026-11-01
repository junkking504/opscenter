import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import LiveKreweHours from '../live-krewe-hours';
import CrewToday from '../crew-today';
import type { HoursDay, KreweHoursSnapshot } from '../lib/krewe-hours-contract';
import type { DesktopCrewMember, DesktopKreweSnapshot, CrewAmounts } from '../lib/people-fleet-contract';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../theme.css';
const amounts:CrewAmounts={hours:8,regularHours:8,overtimeHours:0,jobs:2,revenue:200,labor:160,tips:0,bonuses:0,supplemental:0,totalPay:160};
const base:HoursDay={date:'2026-10-19',hours:8,regular:8,overtime:0,clockIn:'8:00 AM',clockOut:'4:00 PM',corrected:false,role:'Driver',truck:'Truck 1',jobs:2,jobRevenueWorked:200,status:'Recorded'};
const days:HoursDay[]=[{...base,clockIn:''},{...base,date:'2026-10-20',clockOut:'',hours:null,status:'Missing Clock-Out',corrected:true},{...base,date:'2026-10-21',clockIn:'',clockOut:'',hours:null},{...base,date:'2026-10-22',clockOut:'',status:'On Shift'}, {...base,date:'2026-10-23'}, {...base,date:'2026-10-24',isSalary:true,clockIn:'',clockOut:''},{...base,date:'2026-10-25',hours:0,jobs:0,clockIn:'',clockOut:'',status:'No Record'}];
const member:DesktopCrewMember={...amounts,id:'sample',name:'Sample Crew',initials:'SC',role:'Driver',truck:'Truck 1',working:true,clockIn:'8:00 AM',clockOut:'',hourlyRate:20,status:'Clocked in',issue:'Missing clock-out',version:'synthetic',correction:null,days:days.map(day=>({...amounts,...(day.status==='No Record'?{hours:0,regularHours:0,jobs:0,revenue:0,labor:0,totalPay:0}:{}),date:day.date,clockIn:day.clockIn,clockOut:day.clockOut,hours:day.hours,totalPay:day.hours===null?null:day.hours===0?0:160,issue:day.status==='Missing Clock-Out'?'Missing clock-out':''}))};
const hours:KreweHoursSnapshot={date:'2026-10-25',start:'2026-10-19',end:'2026-11-01',generatedAt:'2026-10-25T15:00:00Z',missingDates:[],employees:[{id:member.id,name:member.name,total:32,weeks:[{start:'2026-10-19',end:'2026-10-25',total:32,regular:32,overtime:0,incomplete:true,days}]}]};
if(new URLSearchParams(location.search).has('allMissing')) {
  days.forEach(day=>Object.assign(day,{clockIn:'',clockOut:'',hours:null,jobs:2,status:'Hours Unavailable',isSalary:false}));
  member.days.forEach(day=>Object.assign(day,{clockIn:'',clockOut:'',hours:null,totalPay:null}));
}
const secondDays=days.map((day,index)=>({...day,date:new Date(Date.UTC(2026,9,26+index)).toISOString().slice(0,10)}));
hours.employees[0].weeks.push({...hours.employees[0].weeks[0],start:'2026-10-26',end:'2026-11-01',days:secondDays});
member.days.push(...member.days.map((day,index)=>({...day,date:secondDays[index].date})));
const snapshot:DesktopKreweSnapshot={date:hours.date,start:hours.start,end:hours.end,view:'payperiod',sourceUpdatedAt:hours.generatedAt,missingDates:[],canWrite:true,payrollVisible:true,members:[member],totals:amounts,callIn:null,hoursSnapshot:hours};
window.fetch=async(input,init)=>{if(init?.method&&init.method!=='GET')throw new Error('Operational writes forbidden in fixture');const url=new URL(String(input),location.origin);if(url.pathname==='/api/desktop/krewe/hours')return Response.json(hours);return Response.json({error:'Disabled in synthetic fixture'},{status:503});};
function Fixture(){const [opened,setOpened]=useState('');return <main className="ops-app ops-live" style={{display:'block',padding:12}}><h1>Synthetic Krewe records</h1><div className="live-krewe"><LiveKreweHours date={hours.date} payroll={snapshot}/><CrewToday snapshot={{...snapshot,view:'today'}} date={hours.date} now={Date.parse(hours.generatedAt)} onOpen={(_member,panel)=>setOpened(panel)}/><output>{opened&&`Opened ${opened}`}</output></div></main>;}
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<Fixture/>);
