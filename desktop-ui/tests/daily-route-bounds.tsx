import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import L from 'leaflet';
import ScheduleMap from '../schedule-map';
import {GpsRouteSummary} from '../schedule-gps-route';
import type {ScheduleTruck} from '../lib/schedule-contract';
import type {TruckGpsRoute} from '../lib/gps-route-contract';
import '../app/globals.css';
import '../live-schedule.css';

// Synthetic coordinates only. Completed trips stop before later travel; one
// road segment also extends beyond its endpoint rectangle. No operational API.
const date='2026-09-28';
const points=[[30,-90],[30.01,-89.99],[30.02,-89.98],[30.5,-90.4],[30.51,-90.41]].map(([latitude,longitude],i)=>({latitude,longitude,timestamp:`${date}T${String(13+i).padStart(2,'0')}:00:00.000Z`}));
const detour={latitude:30.3,longitude:-89.7};
const trips=[0,1].map((i,index)=>({id:`trip-${index+1}`,number:index+1,departure:points[i].timestamp,arrival:points[i+1].timestamp,from:{...points[i],address:`Synthetic start ${index+1}`},to:{...points[i+1],address:`Synthetic stop ${index+1}`}}));
const route:TruckGpsRoute={date,truck:'Truck 8',sourceVersion:'synthetic',status:'available',observedAt:points.at(-1)!.timestamp,coveredThrough:points.at(-1)!.timestamp,points,trips,paths:[points.slice(0,3)],gapLinks:[],gaps:2,rejected:0,
  streets:{sourceVersion:'synthetic',status:'available',unmatched:0,paths:[{sourceEdge:0,kind:'matched',points:[points[0],detour,points[1]]},{sourceEdge:1,kind:'matched',points:points.slice(1,3)}]}};
const truck={truck:'Truck 8',...points.at(-1)!,lastGpsUpdate:new Date().toISOString(),ignition:'ON',operationalStatus:'Driving'} as ScheduleTruck;
let map:L.Map;
L.Map.addInitHook(function(this:L.Map){map=this;});
function Fixture() {
  const [mode,setMode]=useState<'overview'|'location'|'route'>('overview');
  const [selectedTrip,setSelectedTrip]=useState<string|null>(null),[reset,setReset]=useState(0),[refresh,setRefresh]=useState(0),[narrow,setNarrow]=useState(false),[metrics,setMetrics]=useState('Loading map');
  const showTrip=(id:string|null)=>{setSelectedTrip(id);setMode('route');setReset(n=>n+1);};
  useEffect(()=>{
    const timer=setInterval(()=>{
      if(!map)return;
      const visible=(p:{latitude:number;longitude:number})=>map.getBounds().contains([p.latitude,p.longitude]);
      setMetrics(`Entire day visible: ${[...points,detour].every(visible)?'PASS':'NO'} · Later GPS visible: ${visible(points.at(-1)!)?'PASS':'NO'} · Road detour visible: ${visible(detour)?'PASS':'NO'} · Zoom: ${map.getZoom()} · Center: ${map.getCenter().lat.toFixed(4)}, ${map.getCenter().lng.toFixed(4)}`);
    },100);
    return()=>clearInterval(timer);
  },[]);
  return <main className="ops-live" style={{padding:20}}>
    <h1>Daily route visibility · synthetic GPS</h1>
    <p>Two completed trips, later GPS positions, and a road detour outside the trip endpoints.</p>
    <div style={{width:narrow?340:700,maxWidth:'95vw',height:narrow?310:440,position:'relative'}}>
      <ScheduleMap appointments={[]} trucks={[truck]} selected={null} selectedTruck="Truck 8" gpsRoute={{...route,observedAt:`refresh-${refresh}`}} selectedTripId={selectedTrip} truckMapView={mode} scope="ALL" resetKey={reset} date={date} onSelect={()=>{}} onSelectTrip={showTrip} onSelectTruck={(_,view='overview')=>{setMode(view);setReset(n=>n+1);}}/>
    </div>
    <p role="status">{metrics}</p>
    <p>Selected: {selectedTrip || 'all trips'} · View: {mode} · Refresh: {refresh}</p>
    <button onClick={()=>setNarrow(value=>!value)}>Toggle narrow map</button>{' '}
    <button onClick={()=>setRefresh(n=>n+1)}>Refresh GPS snapshot</button>
    <GpsRouteSummary date={date} truck="Truck 8" route={route} error="" selectedTrip={selectedTrip} showTrip={showTrip}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
