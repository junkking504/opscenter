import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ScheduleAppointmentSummary from '../schedule-appointment-summary';
import {useRouteEstimate} from '../lib/use-route-estimate';
import type {ScheduleAppointment} from '../lib/schedule-contract';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../approved-workbench.css';

// Sanitized equivalents of the saved response regressions; no live data/routes.
// Requests remain in this tab. This fixture has no service writes or map tiles.
window.EventSource=class extends EventTarget {close(){}} as unknown as typeof EventSource;
window.fetch=async(input,init)=>{
  if(init?.method && init.method!=='GET')throw Error('Writes forbidden');
  const url=new URL(String(input),location.origin);
  if(url.pathname!=='/synthetic-route')throw Error('External requests forbidden');
  await new Promise(resolve=>setTimeout(resolve,200));
  if(url.searchParams.get('mode')==='failed')return Response.json({error:'Synthetic provider failure'},{status:503});
  return Response.json({date:'2026-10-15',calculatedAt:'2026-10-15T15:00:00Z',appointmentId:'synthetic',legs:[],closest:[{truck:'Truck 3',minutes:12,miles:5.1,status:'available',approximate:url.searchParams.get('job')==='lot',gpsUpdatedAt:'2026-10-15T15:00:00Z'}]});
};
const common={recordId:'synthetic',appointmentId:'synthetic',jkNumber:'JK_TEST',status:'Confirmed',truck:'Unassigned',territory:'Northshore',appointmentType:'Job',appointmentTime:'10:00 AM–11:00 AM',appointmentStartMinutes:600,appointmentEndMinutes:660,phone:'',callAhead:'not_called',junkItems:['Chair'],appointmentNotes:[],location:null} as ScheduleAppointment;
const jobs:Record<string,ScheduleAppointment>={
  lot:{...common,customerName:'Lot/unit regression',address:'123 Example Rd Lot 54 Hammond, LA 70403',mapFallback:{location:{latitude:30.47,longitude:-90.54},matchedAddress:'123 Example Rd Unit 54, Hammond, LA 70403',source:'Synthetic cached provider',sourceUrl:'https://example.invalid',detail:'Provider map location. Unit entrance unconfirmed. Not used for arrival or departure detection.',stale:false,visitEligible:false}},
  city:{...common,customerName:'Duplicate-city regression',address:'123 A Street Covington Covington, LA 70433',location:{latitude:30.45,longitude:-90.06}},
};
function App(){
  const [selected,setSelected]=useState('lot'),[mode,setMode]=useState('partial');
  const route=useRouteEstimate(`/synthetic-route?job=${selected}&mode=${mode}`,selected+mode);
  const data=route.data;
  return <main className="ops-live" style={{padding:16,maxWidth:1100,margin:'0 auto'}}>
    <h1>Address identity · offline preview</h1><p>Synthetic saved-response equivalents. Writes: 0. No live providers.</p>
    <nav aria-label="Fixture scenarios" style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16}}>
      <button onClick={()=>setSelected('lot')}>Lot/unit case</button><button onClick={()=>setSelected('city')}>Duplicate-city case</button>
      <button onClick={()=>setMode('partial')}>Partial road results</button><button onClick={()=>setMode('failed')}>Failed road lookup</button>
    </nav>
    <ScheduleAppointmentSummary job={jobs[selected]} closest={data?.closest[0]||null} loading={route.loading} error={route.error} retry={route.retry} isToday busy={false} open={()=>{}} clear={()=>{}}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
