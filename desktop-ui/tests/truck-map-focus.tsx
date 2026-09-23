import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import L from 'leaflet';
import ScheduleMap from '../schedule-map';
import type {ScheduleTruck, ScheduleAppointment} from '../lib/schedule-contract';
import type {TruckGpsRoute} from '../lib/gps-route-contract';
import '../app/globals.css';
import '../live-schedule.css';

const date='2026-09-12';
const truck={truck:'Truck 6',latitude:30.42,longitude:-91.14,lastGpsUpdate:new Date().toISOString(),ignition:'OFF',operationalStatus:'Parked'} as ScheduleTruck;
const points=[[30.42,-91.14],[30.34,-91.02],[30.55,-90.97],[30.44,-91.13],[30.42,-91.14]].map(([latitude,longitude],i)=>({latitude,longitude,timestamp:`${date}T${String(8+i).padStart(2,'0')}:00:00Z`}));
const route:TruckGpsRoute={sourceVersion:'fixture',streets:{sourceVersion:'fixture',status:'available',unmatched:0,paths:points.slice(1).map((point,i)=>({sourceEdge:i,kind:'matched',points:[points[i],point]}))},date,truck:'Truck 6',status:'available',observedAt:points.at(-1)!.timestamp,coveredThrough:points.at(-1)!.timestamp,points,paths:[points],gaps:0,rejected:0};
let map:L.Map;
L.Map.addInitHook(function(this:L.Map){map=this;});
function Fixture() {
 const [selected,setSelected]=useState<string|null>(null),[mode,setMode]=useState<'location'|'overview'|'route'>('overview'),[reset,setReset]=useState(0),[loaded,setLoaded]=useState(false),[metrics,setMetrics]=useState('Loading map'),[snapshot,setSnapshot]=useState(0);
 const appointments=snapshot ? [{recordId:`synthetic-${snapshot}`,jkNumber:'Synthetic refresh',appointmentTime:'',customerName:'Fixture',status:'Confirmed',territory:'NO',address:'New Orleans, LA',location:{latitude:29.95,longitude:-90.07},appointmentNotes:[],junkItems:[]} as ScheduleAppointment] : [];
 const selectTruck=()=>{setSelected('Truck 6');setMode('overview');setReset(n=>n+1);};
 useEffect(()=>{const timer=setInterval(()=>{if(!map)return;const center=map.getCenter();setMetrics(`Zoom ${map.getZoom()} · Truck centered: ${center.distanceTo([truck.latitude!,truck.longitude!])<1?'PASS':'NO'} · Full trail visible: ${points.every(p=>map.getBounds().contains([p.latitude,p.longitude]))?'PASS':'NO'}`);},100);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(selected){const timer=setTimeout(()=>setLoaded(true),700);return()=>clearTimeout(timer);}},[selected]);
 return <main className="ops-live" style={{padding:20}}><h1>Truck click focus · synthetic GPS</h1><p>Select the truck, then use View Routes beside Following Truck 6 to fit the complete day trail.</p><div style={{width:700,maxWidth:'95vw',height:440,position:'relative'}}><ScheduleMap appointments={appointments} trucks={[truck]} selected={null} selectedTruck={selected} gpsRoute={loaded?route:null} truckMapView={mode} scope="ALL" resetKey={reset} date={date} onSelect={()=>{}} onSelectTrip={()=>{setMode('route');setReset(n=>n+1);}} onSelectTruck={(name,view='overview')=>{setSelected(name);setMode(view);setReset(n=>n+1);}}/></div><button onClick={selectTruck}>Select Truck 6 from schedule</button><button onClick={()=>{setSnapshot(n=>n+1);}}>Refresh appointment snapshot</button><p>{mode} · {loaded?'Routes loaded':'Routes pending'}</p><p>{metrics}</p><button onClick={()=>{setSelected(null);setLoaded(false);setReset(n=>n+1);}}>Reset and unload routes</button></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
