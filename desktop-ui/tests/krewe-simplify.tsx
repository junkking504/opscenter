import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import { fixtureSnapshot } from '../../scripts/fixtures/crew-progress';
import type { DesktopCrewMember, DesktopKreweSnapshot, CrewAmounts } from '../lib/people-fleet-contract';
import type { KreweHoursSnapshot } from '../lib/krewe-hours-contract';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../approved-workbench.css';
const date='2026-10-30', start='2026-10-26', stamp='2026-10-30T22:00:00Z';
const params=new URLSearchParams(location.search), manager=params.get('testRole')!=='Operator';
const command=fixtureSnapshot();command.date=date;command.actor={displayName:'Sample User',role:manager?'Manager':'Operator'};
const amounts:CrewAmounts={hours:8,regularHours:8,overtimeHours:0,jobs:2,revenue:800,labor:157.23,tips:12.34,bonuses:19.87,supplemental:0,totalPay:189.44};
const members:DesktopCrewMember[]=[35,36,40,41,null,7.99].map((weekly,i)=>{
 const daily=weekly===null?null:weekly/5;
 const name=['Sample Normal','Sample Amber','Sample Forty','Sample Overtime','Sample Missing','Sample Short'][i];
 const clockInAt=Date.parse(`${date}T13:00:00Z`);
 return {...amounts,hours:daily,id:`sample-${i}`,name,initials:'SC',role:'Driver',truck:'Truck 1',working:true,clockIn:'8:00 AM',clockOut:'4:00 PM',clockInAt,hourlyRate:19.63,status:'Clocked out',issue:'',version:'a',correction:null,drivingScores:[{date,truck:'Truck 1',drivers:[name],score:90-i,display:String(90-i),status:'Recorded',source:'Synthetic',warning:'',attribution:'confirmed',miles:10,driveMinutes:60,idleMinutes:0,safetyScore:90,idleScore:90,afterHoursPenalty:0,events:[]}],days:Array.from({length:5},(_,index)=>({...amounts,hours:daily,date:`2026-10-${26+index}`,clockIn:'8:00 AM',clockOut:'4:00 PM',clockInAt}))};
});
const hours:KreweHoursSnapshot={date,start:'2026-10-19',end:'2026-11-01',generatedAt:stamp,missingDates:[],employees:members.map((member,i)=>({id:member.id,name:member.name,total:[35,36,40,41,null,7.99][i],weeks:[{start,end:'2026-11-01',total:[35,36,40,41,null,7.99][i],regular:35,overtime:0,incomplete:i===4,days:[]}]}))};
const reads:string[]=[];
window.fetch=async(input,init)=>{
 if(init?.method&&init.method!=='GET')throw new Error('Writes are disabled in this fixture');
 const url=new URL(String(input),location.origin);reads.push(url.pathname+url.search);
 if(url.pathname==='/api/desktop/krewe/hours')return manager?Response.json(hours):Response.json({error:'Managers only'},{status:403});
 if(url.pathname==='/api/desktop/krewe'){
 const view=url.searchParams.get('view')||'today';
 if(!manager&&view!=='today'&&view!=='callin')return Response.json({error:'Managers only'},{status:403});
 const snapshot:DesktopKreweSnapshot={date,view:view as DesktopKreweSnapshot['view'],start:view==='today'?date:view==='monthly'?'2026-10-01':'2026-10-19',end:date,sourceUpdatedAt:stamp,missingDates:[],canWrite:true,payrollVisible:true,members:members.map(member=>({...member,days:view==='today'?member.days.filter(day=>day.date===date):member.days})),totals:amounts,callIn:null,...(view==='payperiod'?{hoursSnapshot:hours}:{})};
 return Response.json(snapshot);
 }
 return Response.json({error:'Source disabled in synthetic fixture'},{status:503});
};
Object.assign(window,{kreweReads:reads});
class NoEvents {addEventListener(){}close(){}}
window.EventSource=NoEvents as unknown as typeof EventSource;
createRoot(document.getElementById('root')!).render(<Home live={{snapshot:command,pendingAlertId:null,error:'',onDateChange:()=>{},onAlertAction:async()=>{}}}/>);
