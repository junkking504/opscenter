import {useEffect,useState} from 'react';
import type {StreetRoute,TruckGpsRoute} from './lib/gps-route-contract';
import './schedule-gps-route.css';

export function useTruckGpsRoute(date:string,truck:string|null) {
  const key=truck && /^Truck [1-9]\d*$/.test(truck)?`${date}:${truck}`:'';
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
  const selected=state.key===key?state:{key,route:null,error:''};
  const [streets,setStreets]=useState<StreetRoute|null>(null);
  const [streetError,setStreetError]=useState('');
  const version=selected.route?.sourceVersion;
  useEffect(()=>{
    setStreetError('');
    if(!version || !truck || !selected.route?.points.length)return;
    const abort=new AbortController();
    void (async()=>{
      try{
        const response=await fetch(`/api/desktop/schedule/gps/streets?${new URLSearchParams({date,truck,version})}`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(35_000)])});
        const result=await response.json() as StreetRoute;
        if(!response.ok || result.sourceVersion!==version || !Array.isArray(result.paths))throw new Error('Street route unavailable');
        if(!abort.signal.aborted)setStreets(result);
      }catch{if(!abort.signal.aborted)setStreetError('Street route unavailable. Recorded GPS positions remain visible.');}
    })();
    return()=>abort.abort();
  },[version,date,truck]);
  return {...selected,route:selected.route?{...selected.route,streets:streets && streets.sourceVersion===version?streets:undefined}:null,error:[selected.error,streetError].filter(Boolean).join(' ')};
}
const time=(stamp:string)=>new Date(stamp).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'});
export function GpsRouteSummary({date,truck,route,error,fit}:{date:string;truck:string;route:TruckGpsRoute|null;error:string;fit:()=>void}) {
  return <section className="schedule-gps-summary" aria-label={`${truck} recorded GPS route`}>
    <header><strong>Recorded GPS route</strong>{!!route?.points.length && <button type="button" onClick={fit}>Fit route</button>}</header>
    {route?.streets?.paths.some(path=>path.kind==='estimated') && <p>Dashed streets = estimated connections across missing GPS reports.</p>}
    <p>{date} · {truck}</p>
    {truck==='Unassigned'?<p>Select a truck to view its recorded GPS path.</p>:!route?<p role="status">{error || 'Loading recorded GPS…'}</p>:route.status==='unavailable'?<p>GPS history is unavailable for this date.</p>:route.status==='empty'?<p>No GPS observations recorded for this truck on this date.</p>:<>
      <p><b>{time(route.points[0].timestamp)} – {time(route.coveredThrough || route.points.at(-1)!.timestamp)}</b> · {route.points.length} observations{route.gaps?` · ${route.gaps} ${route.gaps===1?'gap':'gaps'}`:''}</p>
      <p>Blue dots are recorded positions. Solid streets are matched to frequent GPS reports.{route.rejected?' Invalid observations were omitted.':''}</p>
      {!!route.gaps && <p>Long outages and impossible jumps remain disconnected.</p>}
      {!route.streets && !error && <p role="status">Matching GPS to streets…</p>}
      {route.streets?.status==='unavailable' && <p>No connected street route is available for these observations.</p>}
      {!!route.streets?.unmatched && <p>{route.streets.unmatched} connections could not be matched to streets and remain disconnected.</p>}
    </>}
    {route?.observedAt && <p>GPS collected {new Date(route.observedAt).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} CT</p>}
    {route && error && <p role="status">{error}</p>}
  </section>;
}
