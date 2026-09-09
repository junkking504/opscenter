import React from 'react';
import { createRoot } from 'react-dom/client';
import ScheduleStopOrder from '../schedule-stop-order';
import { compareStops } from '../../lib/schedule-stop-order';
import type { ScheduleSnapshot } from '../lib/schedule-contract';
const initial={date:'2026-09-09',observedAt:null,fleet:{isToday:false,trucks:[],lastUpdatedAt:null},appointments:[1,2,3].map(id=>({recordId:`2026-09-09:appointment:${id}`,appointmentId:String(id),version:'1',jkNumber:`JK${id}`,customerName:`Example ${id}`,address:'100 Example St New Orleans LA 70125',status:'Confirmed',truck:'Truck 8',appointmentStartMinutes:480,appointmentEndMinutes:540,appointmentTime:'8:00 AM–9:00 AM',location:{latitude:30,longitude:-90}}))} as ScheduleSnapshot;
function App(){const [snapshot,setSnapshot]=React.useState(initial);return <main className="ops-live"><ScheduleStopOrder snapshot={snapshot} saved={setSnapshot} busy={false} onBusyChange={()=>{}}/><output>{[...snapshot.appointments].sort(compareStops).map(job=>job.jkNumber).join(',')}</output></main>;}
createRoot(document.getElementById('root')!).render(<App/>);
