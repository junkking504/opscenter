import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ScheduleRoutePlan from '../schedule-route-plan';
import {MoveConfirmation} from '../schedule-controls';
import {scheduleMoveProposal} from '../schedule-drag';
import {proposeRoutes,routePlanSourceKey,type PlanRoute} from '../lib/route-plan';
import type {ScheduleAppointment,ScheduleSnapshot,MoveProposal} from '../lib/schedule-contract';
import '../app/globals.css';
import '../live-schedule.css';
import '../live-responsive.css';
import '../workspace-density.css';

const job=(id:string,truck:string,territory='New Orleans')=>({recordId:id,appointmentId:id,version:'v1',jkNumber:`JKTEST${id}`,customerName:`Synthetic Customer ${id}`,phone:'',truck,territory,status:'Confirmed',appointmentType:'Job',hasScheduledTime:true,appointmentTime:'8:00–9:00 AM',appointmentStartMinutes:480,appointmentEndMinutes:540,address:'Synthetic Street, New Orleans',location:{latitude:30,longitude:-90}} as ScheduleAppointment);
let snapshot:ScheduleSnapshot={date:'2099-09-09',observedAt:null,appointments:[job('A','Truck 1'),job('B','Truck 1'),job('C','Unassigned','Northshore'),job('D','Unassigned','Jefferson Parish'),job('E','Truck 2')],fleet:{isToday:false,trucks:[],lastUpdatedAt:null}};
let fail=false;
// Browser-only fixture, synthetic responses; no operational requests can leave.
window.fetch=async(input,init)=>{
  if(new URL(String(input),location.origin).pathname!=='/api/desktop/schedule/plan')return Response.json({error:'All source writes disabled in this fixture.'},{status:403});
  if(fail)return Response.json({error:'Synthetic provider outage. No assignments were changed.'},{status:503});
  const options=JSON.parse(String(init?.body)); const routes:PlanRoute[]=options.routes||proposeRoutes(snapshot.appointments,options);
  return Response.json({sourceKey:routePlanSourceKey(snapshot.appointments),calculatedAt:new Date().toISOString(),excluded:0,routes:routes.map(r=>({...r,stops:r.appointmentIds.map((id,i)=>({id,arrival:options.start+i*55,travelMinutes:i?10:null,miles:i?4.2:null,warnings:i?['Overlapping Windows']:[]}))}))});
};
function Fixture(){
  const [data,setData]=useState(snapshot); const [move,setMove]=useState<MoveProposal|null>(null);const [message,setMessage]=useState('');
  return <main className="ops-live" style={{padding:20}}><h1>Route Planner · Synthetic QA · No Live Writes</h1><div style={{display:'flex',gap:20,padding:12}}><button onClick={()=>{snapshot={...snapshot,appointments:snapshot.appointments.map(j=>({...j,version:j.version+'x'}))};setData(snapshot);}}>Simulate Source Change</button><label><input type="checkbox" onChange={e=>{fail=e.target.checked;}}/>Simulate Failure</label></div><p>{message}</p>
    <div className="live-schedule"><ScheduleRoutePlan snapshot={data} busy={!!move} select={id=>setMessage(`Opened synthetic appointment ${id}`)} review={(job,truck)=>setMove(scheduleMoveProposal(job,truck,job.appointmentStartMinutes,data.appointments))}/>
    {move&&<MoveConfirmation move={move} date={data.date} cancel={()=>setMove(null)} saved={()=>{}} onBusyChange={()=>{}}/>}</div>
  </main>;
}
const root=createRoot(document.getElementById('root')!);root.render(<Fixture/>);import.meta.hot?.dispose(()=>root.unmount());
