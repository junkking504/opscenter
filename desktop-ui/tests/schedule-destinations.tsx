import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import LiveSchedule from '../live-schedule';
import type {ScheduleAppointment} from '../lib/schedule-contract';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';

// Every request and move is synthetic and stays in memory in this browser tab.
const scenario=new URLSearchParams(location.search).get('scenario') || 'unassigned';
const result=new URLSearchParams(location.search).get('result') || 'verified';
let releaseVerification:(()=>void)|undefined;
const assignments=new Map<string,string>();
const writes:Array<{date:string;recordId:string;action:string;values:{truck:string}}>=[];
function appointments(date:string):ScheduleAppointment[] {
  return Array.from({length:scenario==='empty'?0:scenario==='dense'?24:1},(_,index)=>{
    const recordId=`${date}:appointment:${1001+index}`;
    return {recordId,appointmentId:String(1001+index),version:'a'.repeat(64),callAhead:'not_called',jkNumber:`JK100${String(1001+index)}`,appointmentUrl:'',appointmentTime:'9:00 AM–10:00 AM',appointmentStartMinutes:540,appointmentEndMinutes:600,hasScheduledTime:true,customerName:`Example appointment ${index+1}`,customerEmail:'',phone:'',address:'',territory:'Baton Rouge',appointmentType:'Job',status:'Confirmed',truck:assignments.get(recordId)||'Virtual Truck',driver:'',navigator:'',paymentType:'',paymentAmount:0,tipAmount:0,junkItems:[],appointmentNotes:[],cancellationReason:'',location:null};
  });
}
window.fetch=async(input,init)=>{
  const url=new URL(String(input),location.origin),date=url.searchParams.get('date') || '2026-09-08';
  if(init?.method==='POST') {
    if(url.pathname!=='/api/desktop/schedule/operations') return Response.json({error:'No other writes are enabled.'},{status:403});
    const body=JSON.parse(String(init.body));
    writes.push(body);
    if(result==='held') await new Promise<void>(resolve=>{releaseVerification=resolve;window.dispatchEvent(new Event('fixture-write'));});
    const status=result==='held'?'verified':result;
    if(status==='verified') assignments.set(body.recordId,body.values.truck);
    window.dispatchEvent(new Event('fixture-write'));
    return Response.json({receipt:{requestId:body.requestId,status,message:`Synthetic move result: ${status}.`}});
  }
  if(url.pathname==='/api/desktop/schedule/operations' && writes.length){
    const body=writes.at(-1)!;
    assignments.set(body.recordId,body.values.truck);
    return Response.json({receipt:{requestId:url.searchParams.get('requestId'),status:'verified',message:'Synthetic saved result verified.'}});
  }
  if(url.pathname==='/api/desktop/schedule')return Response.json({date,observedAt:'2026-09-07T21:00:00Z',sourceRequest:{state:'ready',message:''},appointments:appointments(date),fleet:{isToday:false,lastUpdatedAt:null,trucks:[]}});
  if(url.pathname==='/api/desktop/schedule/routes')return Response.json({date,calculatedAt:null,legs:[],closest:[],appointmentId:null});
  return Response.json({error:'No operational sources are enabled in this fixture.'},{status:503});
};
function Fixture(){
  const [day,setDay]=useState<'today'|'tomorrow'>('tomorrow');
  const [,setVersion]=useState(0);
  useEffect(()=>{const update=()=>setVersion(value=>value+1);window.addEventListener('fixture-write',update);return()=>window.removeEventListener('fixture-write',update);},[]);
  return <main className="ops-live" style={{padding:12}}><h1 style={{fontSize:16}}>Dispatch check · synthetic {scenario} day · no GPS records</h1><p id="fixture-writes" role="status">Writes: {writes.length}{writes.length?` · ${writes.at(-1)!.date} · ${writes.at(-1)!.recordId} → ${writes.at(-1)!.values.truck || 'Unassigned'}`:''}</p>{releaseVerification && <button onClick={()=>{releaseVerification?.();releaseVerification=undefined;}}>Release Verified Receipt</button>}<LiveSchedule baseDate="2026-09-07" day={day} onDayChange={setDay} report={()=>{}}/></main>;
}
const root=createRoot(document.getElementById('root')!);
root.render(<Fixture/>);
import.meta.hot?.dispose(()=>root.unmount());
