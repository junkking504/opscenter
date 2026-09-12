import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import L from 'leaflet';
import ScheduleMap from '../schedule-map';
import type {ScheduleTruck} from '../lib/schedule-contract';
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
 const [selected,setSelected]=useState<string|null>(null),[mode,setMode]=useState<'location'|'overview'>('overview'),[reset,setReset]=useState(0),[loaded,setLoaded]=useState(false),[metrics,setMetrics]=useState('Loading map');
 useEffect(()=>{const timer=setInterval(()=>{if(!map)return;const center=map.getCenter();setMetrics(`Zoom ${map.getZoom()} · Truck centered: ${center.distanceTo([truck.latitude!,truck.longitude!])<1?'PASS':'NO'} · Full trail visible: ${points.every(p=>map.getBounds().contains([p.latitude,p.longitude]))?'PASS':'NO'}`);},100);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(selected){const timer=setTimeout(()=>setLoaded(true),700);return()=>clearTimeout(timer);}},[selected]);
 return <main className="ops-live" style={{padding:20}}><h1>Truck click focus · synthetic GPS</h1><p>Click Truck 6 for its centered full trail; double-click for zoom 19. Route loads after selection.</p><div style={{width:700,maxWidth:'95vw',height:440,position:'relative'}}><ScheduleMap appointments={[]} trucks={[truck]} selected={null} selectedTruck={selected} gpsRoute={loaded?route:null} truckMapView={mode} scope="ALL" resetKey={reset} date={date} onSelect={()=>{}} onSelectTruck={(name,view='overview')=>{setSelected(name);setMode(view);setReset(n=>n+1);}}/></div><p>{mode} · {loaded?'Routes loaded':'Routes pending'}</p><p>{metrics}</p><button onClick={()=>{setSelected(null);setLoaded(false);setReset(n=>n+1);}}>Reset and unload routes</button></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
