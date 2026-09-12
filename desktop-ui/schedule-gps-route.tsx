import {useEffect,useState} from 'react';
import type {StreetRoute,TruckGpsRoute} from './lib/gps-route-contract';
import './schedule-gps-route.css';
import {gpsTripColor,gpsTripDisplay} from './lib/gps-trip-display';

export function useTruckGpsRoute(date:string,truck:string|null) {
  const key=truck && /^Truck [1-9]\d*$/.test(truck)?`${date}:${truck}`:'';
  const [streets,setStreets]=useState<{key:string;value:StreetRoute|null}>({key:'',value:null});
  const [state,setState]=useState<{key:string;route:TruckGpsRoute|null;error:string}>({key:'',route:null,error:''});
  useEffect(()=>{
    if(!key || !truck) return;
    const abort=new AbortController();let pending=false;
    const load=async()=>{
      if(pending) return;pending=true;
      try {
        const response=await fetch(`/api/desktop/schedule/gps?${new URLSearchParams({date,truck})}`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20_000)])});
        const route=await response.json() as TruckGpsRoute;
        if(!response.ok || route.date!==date || route.truck!==truck || !Array.isArray(route.points) || !Array.isArray(route.paths)) throw new Error('GPS history could not be retrieved.');
        if(!abort.signal.aborted) setState({key,route,error:''});
      } catch {if(!abort.signal.aborted) setState(old=>({key,route:old.key===key?old.route:null,error:'GPS history could not refresh.'}));}
      finally {pending=false;}
    };
    void load();const timer=window.setInterval(()=>void load(),30_000);
    return()=>{abort.abort();window.clearInterval(timer);};
  },[key,date,truck]);
  const version=state.key===key?state.route?.sourceVersion:undefined;
  useEffect(()=>{
    if(!key || !version || !truck)return;
    const abort=new AbortController();let pending=false;
    const load=async()=>{
      if(pending)return;pending=true;
      try {
        const response=await fetch(`/api/desktop/schedule/gps/streets?${new URLSearchParams({date,truck,version})}`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(25_000)])});
        const value=await response.json() as StreetRoute;
        if(response.ok && value.sourceVersion===version && Array.isArray(value.paths) && !abort.signal.aborted)setStreets({key,value});
      } catch {if(!abort.signal.aborted)setStreets(old=>old.key===key && old.value?.sourceVersion===version ? old : {key,value:{sourceVersion:version,status:'unavailable',paths:[],unmatched:0}});}
      finally {pending=false;}
    };
    void load();const timer=window.setInterval(()=>void load(),60_000);
    return()=>{abort.abort();window.clearInterval(timer);};
  },[key,version,date,truck]);
  return state.key===key?{...state,route:state.route?{...state.route,streets:streets.key===key && streets.value?.sourceVersion===version?streets.value || undefined:undefined}:null}:{key,route:null,error:''};
}
const time=(stamp:string)=>new Date(stamp).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'});
export function GpsRouteSummary({truck,route,error,selectedTrip,showTrip}:{date:string;truck:string;route:TruckGpsRoute|null;error:string;selectedTrip:string|null;showTrip:(id:string|null)=>void}) {
  const trips=route?.trips || [];
  const display=route?gpsTripDisplay(route,selectedTrip):null;
  const estimated=display?.paths.some(path=>path.kind==='estimated' || path.kind==='gap');
  const roadStatus=route?.streets?.status;
  const unmatched=route?.streets?.unmatched || 0;
  return <section className="schedule-gps-summary" aria-label={`${truck} trips`}>
    <header><strong>Trips</strong>{trips.length>0 && <button type="button" onClick={()=>showTrip(null)}>Show all trips</button>}</header>
    {!!route?.points.length && <div className="schedule-gps-legend" aria-label="Route legend">
      <span><i className="gps-legend-route" aria-hidden="true"/>Solid lines · colors match trip numbers</span>
      {display?.isolated.length ? <span><i className="gps-legend-point" aria-hidden="true"/>Recorded GPS position</span>:null}
    </div>}
    {estimated && <p>Road routes include inferred sections between GPS reports. Hover a line for details.</p>}
    {!!route?.gaps && <p>GPS coverage has gaps; long outages remain disconnected.</p>}
    {!!route?.points.length && !roadStatus && <p role="status">Loading road routes… Recorded GPS positions are shown.</p>}
    {!!route?.points.length && roadStatus==='unavailable' && <p>Road routes unavailable · recorded GPS positions are shown.</p>}
    {roadStatus==='partial' && <p>{unmatched} GPS sections awaiting road alignment.</p>}
    {!route?<p role="status">{error || 'Loading trips…'}</p>:!trips.length?<p>{route.status==='unavailable'?'Trip history unavailable.':'No trips recorded yet.'}</p>:<ol className="schedule-trip-list">{trips.map(trip=><li key={trip.id}><button type="button" aria-pressed={selectedTrip===trip.id} aria-label={`Show trip ${trip.number}: ${trip.from.address || 'Start'} to ${trip.to.address || 'Stop'}`} onClick={()=>showTrip(trip.id)}><b className="schedule-trip-number" style={{backgroundColor:gpsTripColor(trip.number)}}>{trip.number}</b><span>{trip.from.address || 'Start location'} <span aria-hidden="true">→</span> {trip.to.address || 'Stop location'}<small>{time(trip.departure)} – {time(trip.arrival)}</small></span></button></li>)}</ol>}
    {route && error && <p role="status">Trip history could not refresh.</p>}
  </section>;
}
