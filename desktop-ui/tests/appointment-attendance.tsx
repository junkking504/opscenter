import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useAppointmentAttendance} from '../lib/use-appointment-attendance';
import {AppointmentRegisterRow} from '../appointment-register-row';
import type {ScheduleAppointment} from '../lib/schedule-contract';
const reads:{date:string;signal:AbortSignal;resolve:(response:Response)=>void;done?:boolean}[]=[];
window.fetch=async(input,init)=>{
 const url=new URL(String(input),location.origin);
 if(url.pathname!=='/api/desktop/schedule/cost')return Response.json({error:'No live requests in fixture'},{status:403});
 return new Promise<Response>(resolve=>reads.push({date:url.searchParams.get('date')!,signal:init!.signal!,resolve}));
};
const job={recordId:'synthetic',jkNumber:'JKSYNTHETIC',customerName:'Synthetic appointment',truck:'Truck 6',status:'Confirmed',driver:'',navigator:'',phone:'',address:'Synthetic address',appointmentTime:'10 AM',appointmentType:'Job',appointmentNotes:[],junkItems:[],location:{latitude:30,longitude:-90},paymentAmount:0,tipAmount:0} as unknown as ScheduleAppointment;
function Fixture(){
 const [date,setDate]=useState('2099-10-14'),[revision,setRevision]=useState(0),[enabled,setEnabled]=useState(true),[tick,setTick]=useState(0);
 const state=useAppointmentAttendance(date,String(revision),enabled);
 const finish=(status=200)=>{const r=reads.find(x=>!x.done);if(!r)return;r.done=true;r.resolve(Response.json({date:r.date,rows:{synthetic:{attendance:150,breakEven:null,breakEvenBeforeDisposal:170,missing:['Disposal cost'],attendanceAssumptions:['Synthetic provisional crew']}}},{status}));setTick(tick+1);};
 return <main style={{padding:30,fontFamily:'sans-serif'}}><h1>Cost refresh · synthetic only</h1><p>Day: {date} · Revision: {revision} · Reads: {reads.length} · Aborted: {reads.filter(r=>r.signal.aborted).length}</p><div style={{display:'flex',gap:20}}><button onClick={()=>setRevision(revision+1)}>Change source</button><button onClick={()=>finish()}>Complete read</button><button onClick={()=>finish(503)}>Fail read</button><button onClick={()=>finish(403)}>Deny access</button><button onClick={()=>setDate('2099-10-15')}>Next day</button><button onClick={()=>setEnabled(!enabled)}>Toggle enabled</button></div><pre>{JSON.stringify(state,null,2)}</pre><AppointmentRegisterRow job={job} area="Synthetic" selected={false} attendance={state.denied?undefined:{summary:state.rows.synthetic||null,loading:state.loading,error:state.error}} select={()=>{}} open={()=>{}}/><AppointmentRegisterRow job={{...job,jkNumber:'JKUNLOCATED',location:null}} area="Synthetic" selected={false} attendance={state.denied?undefined:{summary:null,loading:state.loading}} select={()=>{}} open={()=>{}}/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
