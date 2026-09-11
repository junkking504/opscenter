import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import LiveSchedule from '../live-schedule';
import type {TruckGpsRoute} from '../lib/gps-route-contract';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../command-map.css';

// Synthetic data only. The production Leaflet component and polling hook run
// unchanged; no operational API or mutation is enabled in this fixture.
let fail=false,delay=false;
window.fetch=async(input,init)=>{
  const url=new URL(String(input),location.origin),date=url.searchParams.get('date') || '2026-09-06';
  if(init?.method && init.method!=='GET') return Response.json({error:'Writes disabled.'},{status:403});
  if(url.pathname==='/api/desktop/schedule') return Response.json({date,observedAt:null,appointments:[],fleet:{isToday:false,lastUpdatedAt:null,trucks:[]}});
  if(url.pathname==='/api/desktop/schedule/routes') return Response.json({date,calculatedAt:null,legs:[],closest:[],appointmentId:null});
  if(url.pathname==='/api/desktop/schedule/gps/streets') {
    const shift=url.searchParams.get('truck')==='Truck 6'?.1:0;
    const points=[0,1,2,3,4].map(index=>({latitude:30.001+shift+index*.002,longitude:-90.01+(index%3)*.003}));
    return Response.json({sourceVersion:url.searchParams.get('version'),status:'available',unmatched:0,paths:[{kind:'matched',points:points.slice(0,3)},{kind:'estimated',points:points.slice(3)}]});
  }
  if(url.pathname==='/api/desktop/schedule/gps') {
    const truck=url.searchParams.get('truck') || '';
    if(delay) await new Promise(resolve=>setTimeout(resolve,3500));
    if(fail) return Response.json({error:'Synthetic GPS outage.'},{status:503});
    const shift=truck==='Truck 6'?.1:0;
    const points=[0,1,2,15,16].map((minute,index)=>({timestamp:`${date}T13:${String(minute).padStart(2,'0')}:00Z`,latitude:30.001+shift+index*.002,longitude:-90.01+(index%3)*.003}));
    if(truck==='Truck 2') points.forEach(point=>{point.latitude=30.001;point.longitude=-90.01;});
    const route:TruckGpsRoute={sourceVersion:`${date}:${truck}`,date,truck,status:'available',observedAt:`${date}T13:20:00Z`,coveredThrough:points.at(-1)!.timestamp,points,paths:[points.slice(0,3),points.slice(3)],gaps:1,rejected:0};
    route.trips=[{id:'synthetic-trip',number:1,departure:points[0].timestamp,arrival:points.at(-1)!.timestamp,from:{...points[0],address:'Synthetic start'},to:{...points.at(-1)!,address:'Synthetic stop'}}];
    if(date==='2026-09-07' || truck==='Truck 3') Object.assign(route,{status:'empty',coveredThrough:null,points:[],paths:[],trips:[],gaps:0});
    if(truck==='Truck 9' && date==='2026-09-06') route.gapLinks=[[points[2],points[3]]];
    if(truck==='Truck 8') Object.assign(route,{status:'unavailable',observedAt:null,coveredThrough:null,points:[],paths:[],trips:[],gaps:0});
    return Response.json(route);
  }
  return Response.json({error:'No operational sources are enabled.'},{status:503});
};
function Fixture(){
  const [date,setDate]=useState('2026-09-06'),[mode,setMode]=useState(false);
  const [failure,setFailure]=useState(false),[slow,setSlow]=useState(false);
  return <main className="ops-live" style={{padding:12}}><h1 style={{fontSize:16}}>Recorded GPS check · synthetic data · no appointments or current truck positions</h1>
    <div style={{display:'flex',gap:16,padding:'8px 0'}}>
      <label>Fixture date <input aria-label="Fixture date" type="date" value={date} onChange={event=>setDate(event.target.value)}/></label>
      <button onClick={()=>setDate('2026-09-06')}>September 6</button><button onClick={()=>setDate('2026-09-07')}>September 7</button>
      <button onClick={()=>setMode(value=>!value)}>Switch to {mode?'Schedule':'Command map'}</button>
      <label><input type="checkbox" checked={failure} onChange={event=>{fail=event.target.checked;setFailure(fail);}}/> Simulate GPS outage</label>
      <label><input type="checkbox" checked={slow} onChange={event=>{delay=event.target.checked;setSlow(delay);}}/> Delay GPS response</label>
    </div>
    <LiveSchedule baseDate={date} day="today" onDayChange={()=>{}} report={()=>{}} mapOnly={mode}/>
  </main>;
}
const root=createRoot(document.getElementById('root')!);root.render(<Fixture/>);
import.meta.hot?.dispose(()=>root.unmount());
