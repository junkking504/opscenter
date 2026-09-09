import {useEffect,useState} from 'react';
import type {StreetRoute,TruckGpsRoute} from './lib/gps-route-contract';
import './schedule-gps-route.css';

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
      } catch {if(!abort.signal.aborted)setStreets({key,value:{sourceVersion:version,status:'unavailable',paths:[],unmatched:0}});}
      finally {pending=false;}
    };
    void load();const timer=window.setInterval(()=>void load(),60_000);
    return()=>{abort.abort();window.clearInterval(timer);};
  },[key,version,date,truck]);
  return state.key===key?{...state,route:state.route?{...state.route,streets:streets.key===key && streets.value?.sourceVersion===version?streets.value || undefined:undefined}:null}:{key,route:null,error:''};
}
const time=(stamp:string)=>new Date(stamp).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'});
export function GpsRouteSummary({date,truck,route,error,fit}:{date:string;truck:string;route:TruckGpsRoute|null;error:string;fit:()=>void}) {
  return <section className="schedule-gps-summary" aria-label={`${truck} recorded GPS route`}>
    <header><strong>Recorded GPS route</strong>{!!route?.points.length && <button type="button" onClick={fit}>Fit route</button>}</header>
    <p>{date} · {truck}</p>
    {truck==='Unassigned'?<p>Select a truck to view its recorded GPS path.</p>:!route?<p role="status">{error || 'Loading recorded GPS…'}</p>:route.status==='unavailable'?<p>GPS history is unavailable for this date.</p>:route.status==='empty'?<p>No GPS observations recorded for this truck on this date.</p>:<>
      <p><b>{time(route.points[0].timestamp)} – {time(route.coveredThrough || route.points.at(-1)!.timestamp)}</b> · {route.points.length} observations{route.gaps?` · ${route.gaps} ${route.gaps===1?'gap':'gaps'}`:''}</p>
      <p>Dots: recorded GPS. Solid: road-matched. Dashed: estimated road route.{route.rejected?' Invalid observations were omitted.':''}</p>
      {!route.streets?<p role="status">Matching GPS to streets…</p>:route.streets.status==='unavailable'?<p>Street routes unavailable. Showing recorded positions only.</p>:route.streets.status==='partial'?<p>Some sections could not be matched to roads and remain disconnected.</p>:null}
      <p>Roads between GPS reports are inferred; they do not prove the exact streets driven.</p>
      <p>Routing: <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noreferrer">OSRM / FOSSGIS</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Fix the map</a></p>
      {!!route.gaps && <p>Long outages and impossible jumps remain disconnected.</p>}
      {!route.paths.length && !route.gapLinks?.length && <p>Recorded positions are available, but there is no connected trail.</p>}
    </>}
    {route?.observedAt && <p>GPS collected {new Date(route.observedAt).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} CT</p>}
    {route && error && <p role="status">{error} Showing the last retrieved history.</p>}
  </section>;
}
