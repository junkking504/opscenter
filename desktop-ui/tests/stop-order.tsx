import React from 'react';
import { createRoot } from 'react-dom/client';
import ScheduleStopOrder from '../schedule-stop-order';
import { compareStops } from '../../lib/schedule-stop-order';
import type { ScheduleSnapshot } from '../lib/schedule-contract';
const initial={date:'2026-09-09',observedAt:null,fleet:{isToday:false,trucks:[],lastUpdatedAt:null},appointments:[1,2,3].map(id=>({recordId:`2026-09-09:appointment:${id}`,appointmentId:String(id),version:'1',jkNumber:`JK${id}`,customerName:`Example ${id}`,address:'100 Example St New Orleans LA 70125',status:'Confirmed',truck:'Truck 8',appointmentStartMinutes:480,appointmentEndMinutes:540,appointmentTime:'8:00 AM–9:00 AM',location:{latitude:30,longitude:-90}}))} as ScheduleSnapshot;
const multi = new URLSearchParams(location.search).has('multi');
if(new URLSearchParams(location.search).has('fleet')) {
 initial.fleet={isToday:!new URLSearchParams(location.search).has('historical'),lastUpdatedAt:null,trucks:[
  {truck:'Truck# 2',latitude:30.4,longitude:-91.16,lastGpsUpdate:new Date().toISOString(),speed:18},
  {truck:'Truck 3',latitude:30.47,longitude:-91.05,lastGpsUpdate:new Date(Date.now()-30*60_000).toISOString(),speed:0},
  {truck:'Truck 8',latitude:29.97,longitude:-90.09,lastGpsUpdate:new Date().toISOString(),speed:0,ignition:'OFF'},
  {truck:'Truck 9',latitude:null,longitude:null,lastGpsUpdate:null},
 ] as ScheduleSnapshot['fleet']['trucks']};
}
if (multi) {
  initial.appointments.push(...initial.appointments.slice(0,2).map((job,index)=>({...job,recordId:`2026-09-09:appointment:${index+4}`,appointmentId:String(index+4),jkNumber:`JK${index+4}`,customerName:`Truck 2 stop ${index+1}`,truck:'Truck 2',appointmentStartMinutes:600+index*120,appointmentEndMinutes:660+index*120,appointmentTime:index===0?'10:00 AM–11:00 AM':'12:00 PM–1:00 PM'})));
  initial.appointments=initial.appointments.map((job,index)=>({...job,location:{latitude:job.truck==='Truck 2'?30.42+(index-3)*.02:29.96+index*.012,longitude:job.truck==='Truck 2'?-91.14+(index-3)*.025:-90.06-index*.018}}));
  let savedSnapshot=initial;
  window.fetch=async (_url,options)=>{
    const body=JSON.parse(String(options?.body));
    if(body.action==='save') savedSnapshot={...savedSnapshot,appointments:savedSnapshot.appointments.map(job=>body.ids.includes(job.recordId)?{...job,visitOrder:body.ids.indexOf(job.recordId)}:job)};
    return new Response(JSON.stringify(body.action==='save'?{snapshot:savedSnapshot}:{ids:body.ids,legs:body.ids.slice(1).map((id:string,index:number)=>{const from=savedSnapshot.appointments.find(j=>j.recordId===body.ids[index])!,to=savedSnapshot.appointments.find(j=>j.recordId===id)!;return {fromAppointmentId:from.recordId,toAppointmentId:id,source:'osm_road_estimate',travelMinutes:12,miles:5,geometry:[from.location,{latitude:to.location!.latitude,longitude:from.location!.longitude},to.location]};})}),{status:200,headers:{'Content-Type':'application/json'}});
  };
}
function App(){const [snapshot,setSnapshot]=React.useState(initial);return <main className="ops-live"><div className="schedule-board-layout map-open"><div className="schedule-board-actions"><ScheduleStopOrder snapshot={snapshot} saved={setSnapshot} truck={multi?null:"Truck 8"} selectedAppointmentId={null} busy={false} onBusyChange={()=>{}}/></div></div><output>{[...snapshot.appointments].sort(compareStops).map(job=>job.jkNumber).join(',')}</output>{multi && <pre aria-label="Saved assignments and times">{JSON.stringify(snapshot.appointments.map(job=>({id:job.jkNumber,truck:job.truck,time:job.appointmentTime,order:job.visitOrder})),null,2)}</pre>}</main>;}
createRoot(document.getElementById('root')!).render(<App/>);
